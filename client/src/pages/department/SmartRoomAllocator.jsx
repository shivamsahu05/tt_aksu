import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import Swal from 'sweetalert2';
import api from '../../utils/api';
import PageHeader from '../../components/common/PageHeader';

const formatClassName = (sec, sectionCounts = {}) => {
    const mapSection = (secName, total) => {
        if (!secName || total <= 1) return '';
        const trimmed = String(secName).trim().toUpperCase();
        if (trimmed.length === 1 && trimmed >= 'A' && trimmed <= 'Z') {
            return ` B${trimmed.charCodeAt(0) - 64}`;
        }
        return ` ${secName.trim()}`;
    };

    if (sec.isMergedGroup) {
        const names = sec.originalSections.map(s => {
            const key = `${s.program_name}_${s.semester}`;
            const total = sectionCounts[key] || 1;
            return `${s.program_name}${mapSection(s.section_name, total)}`;
        });
        return `${sec.semester} ${names.join(' & ')}`;
    }

    const key = `${sec.program_name}_${sec.semester}`;
    const total = sectionCounts[key] || 1;
    return `${sec.semester} ${sec.program_name}${mapSection(sec.section_name, total)}`.trim();
};

const normalizeSubjectName = (name) => {
    if (!name) return '';
    return name.toLowerCase().replace(/lab/g, '').replace(/[^a-z0-9]/g, '').trim();
};

const SmartRoomAllocator = () => {
    const { user } = useAuth();
    const isDeptAdmin = user?.role === 'DEPARTMENT_ADMIN';
    const [buildings, setBuildings] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [sessions, setSessions] = useState([]);

    const [selectedBuilding, setSelectedBuilding] = useState('all');
    const [selectedDepartment, setSelectedDepartment] = useState(isDeptAdmin ? user.department_id : 'all');
    const [selectedSession, setSelectedSession] = useState('');

    const [sections, setSections] = useState([]);
    const [rooms, setRooms] = useState([]);
    const [labSubjects, setLabSubjects] = useState([]);
    const [loading, setLoading] = useState(false);

    // Interactive Selection State
    const [selectedTheoryRooms, setSelectedTheoryRooms] = useState({});
    const [selectedLabRooms, setSelectedLabRooms] = useState({});
    const [isSaving, setIsSaving] = useState(false);

    const handleRoomSelect = (secId, selectedRoomId, currentRoomId) => {
        // Find if usage is already >= 2 (excluding current assignment)
        // Wait, currentRoomAllocations comes from the state below, we can access it here if we pass the current allocations or use the latest.
        // Actually it's better to calculate usage right here.
        let usage = 0;
        Object.values(selectedTheoryRooms).forEach(roomId => {
            if (roomId === selectedRoomId) usage++;
        });
        // We also need to add db usage? The component uses `currentRoomAllocations`.

        // Let's just do the simplest Swal trigger here:
        setSelectedTheoryRooms({ ...selectedTheoryRooms, [secId]: selectedRoomId });
    };

    // Inline Strength Editing
    const [editingStrength, setEditingStrength] = useState(null);
    const [tempStrength, setTempStrength] = useState('');
    const [isUpdatingStrength, setIsUpdatingStrength] = useState(false);

    // Pre-compute suggestions using useMemo to avoid re-renders and track used rooms
    const sectionSuggestions = React.useMemo(() => {
        if (!sections.length) return [];

        // Tracks how many times a room is assigned. Key: roomId, Value: count
        const usedTheoryRooms = new Map();

        // Initialize with database counts to respect global limits
        rooms.forEach(r => {
            usedTheoryRooms.set(r.id, r.theory_allocation_count || 0);
        });

        // Subtract the current sections that are already assigned to avoid double counting them when generating suggestions
        sections.forEach(sec => {
            if (sec.home_room_id && usedTheoryRooms.has(sec.home_room_id)) {
                usedTheoryRooms.set(sec.home_room_id, Math.max(0, usedTheoryRooms.get(sec.home_room_id) - 1));
            }
        });

        // 1. Group sections by merge_group_id and count sections per program
        const groups = {};
        const singleSections = [];
        const sectionCounts = {};

        sections.forEach(sec => {
            const key = `${sec.program_name}_${sec.semester}`;
            sectionCounts[key] = (sectionCounts[key] || 0) + 1;

            if (sec.merge_group_id) {
                if (!groups[sec.merge_group_id]) {
                    groups[sec.merge_group_id] = [];
                }
                groups[sec.merge_group_id].push(sec);
            } else {
                singleSections.push({ ...sec, isMergedGroup: false });
            }
        });

        // Convert groups to "grouped sections"
        const mergedGroups = Object.keys(groups).map(groupId => {
            const groupSecs = groups[groupId];
            const totalStrength = groupSecs.reduce((sum, s) => sum + (s.student_strength || 0), 0);

            const item = {
                id: `merge_${groupId}`,
                isMergedGroup: true,
                merge_group_id: groupId,
                originalSections: groupSecs,
                department_id: groupSecs[0].department_id,
                dept_building_id: groupSecs[0].dept_building_id,
                program_name: groupSecs[0].program_name,
                section_name: 'Merged',
                semester: groupSecs[0].semester,
                student_strength: totalStrength,
                mode: groupSecs.some(s => s.mode === 'Online') ? 'Online' : 'Offline',
                home_room_id: groupSecs[0].home_room_id,
                home_room_number: groupSecs[0].home_room_number
            };
            item.display_name = formatClassName(item, sectionCounts);
            return item;
        });

        const combinedList = [...singleSections.map(s => ({ ...s, display_name: formatClassName(s, sectionCounts) })), ...mergedGroups];

        // Sort by strength descending so largest classes get first pick of rooms
        combinedList.sort((a, b) => (b.student_strength || 0) - (a.student_strength || 0));

        // 2. Compute suggestions for all items in combinedList
        let floatingSuggestionsCount = 0;
        return combinedList.map(item => {
            if (item.mode === 'Online') {
                return { ...item, theorySugg: null, isOnline: true, noStrength: false, labSubjectSuggs: [] };
            }

            const strength = item.student_strength || 0;
            if (strength === 0) {
                return { ...item, theorySugg: null, isOnline: false, noStrength: true, labSubjectSuggs: [] };
            }

            const theoryRoomsAll = rooms.filter(r => {
                if (r.room_type === 'lab') return false;
                // If the room belongs to the class's department, allow it
                if (r.department_id === item.department_id) return true;
                // If it's a shared room, only allow it if it's in the same building as the class's department
                if (!r.department_id || r.department_id == 0) {
                    return r.building_id === item.dept_building_id;
                }
                return false;
            });
            // Only consider rooms that have been assigned less than 2 times
            const availableRooms = theoryRoomsAll.filter(r => (usedTheoryRooms.get(r.id) || 0) < 2);

            let theorySugg = null;
            let bufferRatio = 0.85; // 15% capacity buffer for early semesters
            const semNum = parseInt(item.semester, 10);
            if (!isNaN(semNum) && semNum >= 6) {
                bufferRatio = 0.70; // 30% capacity buffer for last year (sem 6+)
            }
            const adjustedStrength = strength * bufferRatio;

            if (availableRooms.length > 0) {
                const validRooms = availableRooms.filter(r => r.capacity >= adjustedStrength);

                if (!isNaN(semNum) && semNum >= 5 && strength <= 35 && floatingSuggestionsCount < 2) {
                    theorySugg = { room: { id: 'none', room_number: 'No Permanent Room (Floating)' }, exactFit: true };
                    floatingSuggestionsCount++;
                } else if (validRooms.length > 0) {
                    validRooms.sort((a, b) => a.capacity - b.capacity);
                    theorySugg = { room: validRooms[0], exactFit: true };
                } else {
                    // Fall back to largest available room, preferring unused rooms on a tie
                    availableRooms.sort((a, b) => b.capacity - a.capacity || (usedTheoryRooms.get(a.id) || 0) - (usedTheoryRooms.get(b.id) || 0));
                    theorySugg = { room: availableRooms[0], exactFit: false };
                }

                if (theorySugg && theorySugg.room.id !== 'none') {
                    usedTheoryRooms.set(theorySugg.room.id, (usedTheoryRooms.get(theorySugg.room.id) || 0) + 1);
                }
            } else if (!isNaN(semNum) && semNum >= 5 && strength <= 35 && floatingSuggestionsCount < 2) {
                 theorySugg = { room: { id: 'none', room_number: 'No Permanent Room (Floating)' }, exactFit: true };
                 floatingSuggestionsCount++;
            }

            // Calculate lab suggestions per subject
            let itemLabSubjects = [];
            if (!item.isMergedGroup) {
                const raw = labSubjects.filter(sub =>
                    sub.program_name === item.program_name &&
                    sub.semester === item.semester &&
                    (sub.section_id === null || sub.section_id === item.id)
                );
                const seen = new Set();
                for (const sub of raw) {
                    if (!seen.has(sub.id)) {
                        seen.add(sub.id);
                        itemLabSubjects.push({ subject: sub, strength: strength, originalIds: [sub.id] });
                    }
                }
            } else {
                const labMap = {};
                item.originalSections.forEach(sec => {
                    const raw = labSubjects.filter(sub =>
                        sub.program_name === sec.program_name &&
                        sub.semester === sec.semester &&
                        (sub.section_id === null || sub.section_id === sec.id)
                    );
                    const seen = new Set();
                    for (const sub of raw) {
                        if (!seen.has(sub.id)) {
                            seen.add(sub.id);
                            const norm = normalizeSubjectName(sub.full_name);
                            if (!labMap[norm]) {
                                labMap[norm] = { subject: sub, totalStrength: 0, sectionsCount: 0, originalIds: new Set() };
                            }
                            labMap[norm].totalStrength += (sec.student_strength || 0);
                            labMap[norm].sectionsCount += 1;
                            labMap[norm].originalIds.add(sub.id);
                        }
                    }
                });
                Object.values(labMap).forEach(labObj => {
                    itemLabSubjects.push({
                        subject: labObj.subject,
                        strength: labObj.totalStrength,
                        sectionsCount: labObj.sectionsCount,
                        originalIds: Array.from(labObj.originalIds),
                        sectionForLab: null // Since they are grouped, it applies to the whole merged group
                    });
                });
            }

            const sectionUsedLabRooms = new Set();
            const labSubjectSuggs = itemLabSubjects.map(labObj => {
                const sub = labObj.subject;
                const labRooms = rooms.filter(r => {
                    if (r.room_type !== 'lab') return false;
                    if (!r.department_id || r.department_id == 0) return true;
                    return r.department_id === item.department_id;
                });
                let suggs = [];
                let bufferRatio = 0.85;
                const semNum = parseInt(item.semester, 10);
                if (!isNaN(semNum) && semNum > 5) {
                    bufferRatio = 0.75;
                }
                const adjLabStrength = labObj.strength * bufferRatio;
                if (labRooms.length > 0) {
                    const validLabs = labRooms.filter(r => r.capacity >= adjLabStrength);
                    let sortedLabs = validLabs.length > 0
                        ? [...validLabs].sort((a, b) => a.capacity - b.capacity)
                        : [...labRooms].sort((a, b) => b.capacity - a.capacity);

                    let topLab = sortedLabs.find(l => !sectionUsedLabRooms.has(l.id));
                    if (topLab) {
                        sectionUsedLabRooms.add(topLab.id);
                        suggs = [topLab, ...sortedLabs.filter(l => l.id !== topLab.id)];
                    } else {
                        suggs = sortedLabs;
                    }
                }
                return {
                    subject: sub,
                    suggestions: suggs,
                    isFit: suggs.length > 0 && suggs[0].capacity >= adjLabStrength,
                    labStrength: labObj.strength,
                    isSharedInGroup: item.isMergedGroup && labObj.sectionsCount > 1,
                    originalIds: labObj.originalIds
                };
            });

            return { ...item, theorySugg, noStrength: false, labSubjectSuggs };
        });
    }, [sections, rooms, labSubjects]);

    // Stats Modal State
    const [statsModal, setStatsModal] = useState({ show: false, title: '', type: '', data: [] });

    const openStatsModal = (type, title) => {
        let data = [];
        const roomUsage = {};
        sectionSuggestions.forEach(sec => {
            if (!sec.isOnline && !sec.noStrength && sec.home_room_id) {
                roomUsage[sec.home_room_id] = (roomUsage[sec.home_room_id] || 0) + 1;
            }
        });

        if (type === 'total') {
            data = sectionSuggestions;
        } else if (type === 'allocated') {
            data = sectionSuggestions.filter(sec => !sec.isOnline && !sec.noStrength && sec.home_room_id);
        } else if (type === 'totalRooms') {
            data = rooms.filter(r => {
                if (r.room_type === 'lab') return false;
                if (selectedDepartment && selectedDepartment !== 'all') {
                    return r.department_id == selectedDepartment || !r.department_id || r.department_id == 0;
                }
                return true;
            });
        } else if (type === 'roomsUsed') {
            data = rooms.filter(r => {
                if (r.room_type === 'lab') return false;
                const base = baseRoomUsage[r.id] || 0;
                const current = currentRoomAllocations[r.id] || 0;
                if ((base + current) === 0) return false;
                
                const uiConflicts = sectionSuggestions.filter(s => {
                    const sSelectedId = selectedTheoryRooms[s.id] || s.home_room_id || (s.theorySugg?.room?.id);
                    return sSelectedId == r.id;
                });
                const dbConflicts = r.theory_allocated_classes ? r.theory_allocated_classes.split(', ') : [];
                if (uiConflicts.length === 0 && dbConflicts.length === 0) return false;

                if (selectedDepartment && selectedDepartment !== 'all') {
                    return r.department_id == selectedDepartment || !r.department_id || r.department_id == 0;
                }
                return true;
            });
        } else if (type === 'shared') {
            data = rooms.filter(r => !r.department_id || r.department_id == 0);
        } else if (type === 'available') {
            data = rooms.filter(r => {
                if (r.room_type === 'lab') return false;
                const uiConflicts = sectionSuggestions.filter(s => {
                    const sSelectedId = selectedTheoryRooms[s.id] || s.home_room_id || (s.theorySugg?.room?.id);
                    return sSelectedId == r.id;
                });
                
                const dbConflicts = r.theory_allocated_classes ? r.theory_allocated_classes.split(', ') : [];
                const uiConflictNames = uiConflicts.map(s => s.display_name);
                
                const filteredDbConflicts = dbConflicts.filter(dbStr => {
                    const cleanDbStr = dbStr.replace(/ [A-Z0-9]+$/, '');
                    return !uiConflictNames.some(uiStr => dbStr.includes(uiStr) || uiStr.includes(cleanDbStr));
                });
                
                const totalAllocations = uiConflictNames.length + filteredDbConflicts.length;
                
                const isShared = !r.department_id || r.department_id == 0;
                if (isShared) {
                    if (totalAllocations >= 3) return false;
                } else {
                    if (totalAllocations > 0) return false;
                }

                if (selectedDepartment && selectedDepartment !== 'all') {
                    return r.department_id == selectedDepartment || !r.department_id || r.department_id == 0;
                }
                return true;
            });
        }

        setStatsModal({ show: true, title, type, data });
    };

    // Lab Suggestion Modal State
    const [showLabModal, setShowLabModal] = useState(false);
    const [activeSection, setActiveSection] = useState(null);
    const [expandedLabSubject, setExpandedLabSubject] = useState(null);

    useEffect(() => {
        fetchInitialData();
    }, []);

    useEffect(() => {
        if (selectedSession && (selectedDepartment || selectedBuilding)) {
            fetchSuggestions();
        }
    }, [selectedDepartment, selectedSession, selectedBuilding]);

    const fetchInitialData = async () => {
        try {
            const [deptRes, sessRes, bldgRes] = await Promise.all([
                api.get('/departments?limit=100'),
                api.get('/sessions'),
                api.get('/rooms/buildings')
            ]);

            setDepartments(deptRes.data.data);
            setSessions(sessRes.data.data);
            setBuildings(bldgRes.data.data);

            const activeSession = sessRes.data.data.find(s => s.is_active);
            if (activeSession) setSelectedSession(activeSession.id);
            else if (sessRes.data.data.length > 0) setSelectedSession(sessRes.data.data[0].id);

            if (deptRes.data.data.length > 0) {
                setSelectedDepartment('all');
            }
        } catch (error) {
            toast.error('Failed to load filters');
        }
    };

    const fetchSuggestions = async () => {
        try {
            setLoading(true);
            const res = await api.get(`/classes/sections-suggestions?department_id=${selectedDepartment}&session_id=${selectedSession}&building_id=${selectedBuilding}`);
            if (res.data.success) {
                setSections(res.data.data.sections);
                setRooms(res.data.data.rooms);
                setLabSubjects(res.data.data.labSubjects || []);
            }
        } catch (error) {
            toast.error('Failed to fetch smart room suggestions');
        } finally {
            setLoading(false);
        }
    };

    // Smart Matcher Logic for Labs (Modal view)

    const getLabSuggestions = (strength) => {
        const labRooms = rooms.filter(r => r.room_type === 'lab');
        if (labRooms.length === 0) return [];

        const validLabs = labRooms.filter(r => r.capacity >= strength);
        if (validLabs.length > 0) {
            return validLabs.sort((a, b) => a.capacity - b.capacity);
        } else {
            // Fallback: sort largest first
            return labRooms.sort((a, b) => b.capacity - a.capacity);
        }
    };

    const handleViewLabs = (section) => {
        setActiveSection(section);
        setShowLabModal(true);
    };

    const getTheoryConflicts = (roomId, currentSectionId) => {
        if (!roomId) return [];
        return sectionSuggestions.filter(s => {
            if (s.id === currentSectionId) return false;
            const sSelectedId = selectedTheoryRooms[s.id] || s.home_room_id || (s.theorySugg?.room?.id);
            return sSelectedId == roomId;
        }).map(s => s.display_name);
    };

    const getLabConflicts = (roomId, currentSectionId, currentSubjectId) => {
        if (!roomId) return [];
        const conflicts = [];
        sectionSuggestions.forEach(s => {
            if (s.labSubjectSuggs) {
                s.labSubjectSuggs.forEach(subObj => {
                    if (s.id === currentSectionId && subObj.subject.id === currentSubjectId) return;
                    const key = `${s.id}_${subObj.subject.id}_all`;
                    // Default to suggestion if not manually selected
                    const selectedId = selectedLabRooms[key] || subObj.subject.saved_room_id || (subObj.suggestions[0]?.id);
                    if (selectedId == roomId) {
                        conflicts.push(`${s.display_name} (${subObj.subject.short_code})`);
                    }
                });
            }
        });
        return conflicts;
    };

    const handleSaveAllocations = async () => {
        try {
            setIsSaving(true);
            const theoryAllocations = [];
            const labAllocations = [];

            sectionSuggestions.forEach(item => {
                if (!item.noStrength && !item.isOnline) {
                    let theoryRoomId = selectedTheoryRooms[item.id] !== undefined ? selectedTheoryRooms[item.id] : (item.home_room_id || (item.theorySugg?.room?.id) || null);
                    if (theoryRoomId === 'none') theoryRoomId = null;

                    if (item.isMergedGroup) {
                        item.originalSections.forEach(origSec => {
                            theoryAllocations.push({ section_id: origSec.id, room_id: theoryRoomId });
                            if (item.labSubjectSuggs) {
                                item.labSubjectSuggs.forEach(subObj => {
                                    const labRoomId = selectedLabRooms[`${item.id}_${subObj.subject.id}_all`] || subObj.subject.saved_room_id || (subObj.suggestions[0]?.id) || null;
                                    subObj.originalIds.forEach(origSubId => {
                                        const origSecHasSubject = labSubjects.some(sub =>
                                            sub.id === origSubId &&
                                            sub.program_name === origSec.program_name &&
                                            sub.semester === origSec.semester &&
                                            (sub.section_id === null || sub.section_id === origSec.id)
                                        );
                                        if (origSecHasSubject) {
                                            labAllocations.push({
                                                section_id: origSec.id,
                                                subject_id: origSubId,
                                                room_id: labRoomId
                                            });
                                        }
                                    });
                                });
                            }
                        });
                    } else {
                        theoryAllocations.push({ section_id: item.id, room_id: theoryRoomId });
                        if (item.labSubjectSuggs) {
                            item.labSubjectSuggs.forEach(subObj => {
                                const labRoomId = selectedLabRooms[`${item.id}_${subObj.subject.id}_all`] || subObj.subject.saved_room_id || (subObj.suggestions[0]?.id) || null;
                                labAllocations.push({
                                    section_id: item.id,
                                    subject_id: subObj.subject.id,
                                    room_id: labRoomId
                                });
                            });
                        }
                    }
                }
            });

            const res = await api.post('/classes/save-room-allocations', { theoryAllocations, labAllocations });
            if (res.data.success) {
                toast.success('Room allocations saved successfully!');
                fetchSuggestions(); // Refresh data
            }
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to save allocations');
        } finally {
            setIsSaving(false);
        }
    };

    const handleUpdateStrength = async (sectionId) => {
        try {
            if (!tempStrength || isNaN(tempStrength) || parseInt(tempStrength) < 0) {
                toast.error('Please enter a valid positive number');
                return;
            }
            setIsUpdatingStrength(true);
            const res = await api.put(`/classes/sections/${sectionId}/strength`, { student_strength: parseInt(tempStrength) });
            if (res.data.success) {
                toast.success('Section strength updated!');
                setEditingStrength(null);
                fetchSuggestions(); // Refresh to recalculate room allocations
            }
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to update strength');
        } finally {
            setIsUpdatingStrength(false);
        }
    };

    const handleClearAll = async () => {
        if (sectionSuggestions.length === 0) return;

        const result = await Swal.fire({
            title: 'Clear All Allocations?',
            text: "This will remove all current room assignments from the database for this department and session. Are you sure?",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#6c757d',
            confirmButtonText: 'Yes, clear all!'
        });

        if (result.isConfirmed) {
            try {
                setIsSaving(true);
                const theoryAllocations = [];
                const labAllocations = [];

                sectionSuggestions.forEach(item => {
                    if (!item.noStrength && !item.isOnline) {
                        if (item.isMergedGroup) {
                            item.originalSections.forEach(origSec => {
                                theoryAllocations.push({ section_id: origSec.id, room_id: null });
                                if (item.labSubjectSuggs) {
                                    item.labSubjectSuggs.forEach(subObj => {
                                        subObj.originalIds.forEach(origSubId => {
                                            const origSecHasSubject = labSubjects.some(sub =>
                                                sub.id === origSubId &&
                                                sub.program_name === origSec.program_name &&
                                                sub.semester === origSec.semester &&
                                                (sub.section_id === null || sub.section_id === origSec.id)
                                            );
                                            if (origSecHasSubject) {
                                                labAllocations.push({
                                                    section_id: origSec.id,
                                                    subject_id: origSubId,
                                                    room_id: null
                                                });
                                            }
                                        });
                                    });
                                }
                            });
                        } else {
                            theoryAllocations.push({ section_id: item.id, room_id: null });
                            if (item.labSubjectSuggs) {
                                item.labSubjectSuggs.forEach(subObj => {
                                    labAllocations.push({
                                        section_id: item.id,
                                        subject_id: subObj.subject.id,
                                        room_id: null
                                    });
                                });
                            }
                        }
                    }
                });

                const res = await api.post('/classes/save-room-allocations', { theoryAllocations, labAllocations });
                if (res.data.success) {
                    Swal.fire('Cleared!', 'All room allocations have been removed.', 'success');
                    setSelectedTheoryRooms({});
                    setSelectedLabRooms({});
                    fetchSuggestions();
                }
            } catch (error) {
                toast.error(error.response?.data?.message || 'Failed to clear allocations');
            } finally {
                setIsSaving(false);
            }
        }
    };

    const handleRefresh = () => {
        setSelectedTheoryRooms({});
        setSelectedLabRooms({});
        fetchSuggestions();
    };

    const baseRoomUsage = React.useMemo(() => {
        const usage = {};
        rooms.forEach(r => {
            usage[r.id] = r.theory_allocation_count || 0;
        });
        sections.forEach(sec => {
            if (sec.home_room_id && usage[sec.home_room_id] !== undefined) {
                usage[sec.home_room_id] = Math.max(0, usage[sec.home_room_id] - 1);
            }
        });
        return usage;
    }, [rooms, sections]);

    const currentRoomAllocations = React.useMemo(() => {
        const counts = {};
        sectionSuggestions.forEach(sec => {
            if (sec.isOnline || sec.noStrength) return;
            const roomId = selectedTheoryRooms[sec.id] || (sec.theorySugg ? sec.theorySugg.room.id : sec.home_room_id);
            if (roomId) counts[roomId] = (counts[roomId] || 0) + 1;
        });
        return counts;
    }, [sectionSuggestions, selectedTheoryRooms]);

    const overviewStats = React.useMemo(() => {
        const stats = {
            totalClasses: 0,
            allocatedClasses: 0,
            totalRooms: 0,
            roomsUsed: 0,
            availableRooms: 0,
            sharedRoomsCount: 0
        };

        const roomUsage = {};

        sectionSuggestions.forEach(sec => {
            stats.totalClasses++;
            if (!sec.isOnline) {
                const theoryRoomId = sec.home_room_id;
                if (theoryRoomId) {
                    stats.allocatedClasses++;
                    roomUsage[theoryRoomId] = (roomUsage[theoryRoomId] || 0) + 1;
                }
            }
        });

        stats.sharedRoomsCount = rooms.filter(r => !r.department_id || r.department_id == 0).length;
        stats.totalRooms = rooms.filter(r => {
            if (r.room_type === 'lab') return false;
            if (selectedDepartment && selectedDepartment !== 'all') {
                return r.department_id == selectedDepartment || !r.department_id || r.department_id == 0;
            }
            return true;
        }).length;

        stats.roomsUsed = rooms.filter(r => {
            if (r.room_type === 'lab') return false;
            const base = baseRoomUsage[r.id] || 0;
            const current = currentRoomAllocations[r.id] || 0;
            if ((base + current) === 0) return false;
            if (selectedDepartment && selectedDepartment !== 'all') {
                return r.department_id == selectedDepartment || !r.department_id || r.department_id == 0;
            }
            return true;
        }).length;

        stats.availableRooms = stats.totalRooms - stats.roomsUsed;

        return stats;
    }, [sectionSuggestions, selectedTheoryRooms, rooms, currentRoomAllocations, baseRoomUsage, selectedDepartment]);

    return (
        <div className="page-content">
            <PageHeader
                title="Smart Room Allocator"
                subtitle="Intelligently suggest optimal rooms and labs based on class student strength and room capacity"
                icon="bi-lightbulb-fill"
            />

            {sectionSuggestions.length > 0 && !loading && (
                <div className="row g-3 mb-4">
                    <div className="col-md-2 col-6">
                        <div className="card bg-primary bg-opacity-10 border-primary border-opacity-25 h-100 shadow-sm cursor-pointer" onClick={() => openStatsModal('total', 'Total Classes')} style={{ cursor: 'pointer' }}>
                            <div className="card-body py-3 text-center">
                                <h6 className="text-primary opacity-75 mb-1">Total Classes</h6>
                                <h3 className="text-primary mb-0 fw-bold">{overviewStats.totalClasses}</h3>
                                <div className="text-primary opacity-75 mt-1" style={{ fontSize: '0.65rem', lineHeight: '1.2' }}>Active sections</div>
                            </div>
                        </div>
                    </div>
                    <div className="col-md-2 col-6">
                        <div className="card bg-success bg-opacity-10 border-success border-opacity-25 h-100 shadow-sm cursor-pointer" onClick={() => openStatsModal('allocated', 'Allocated Classes')} style={{ cursor: 'pointer' }}>
                            <div className="card-body py-3 text-center">
                                <h6 className="text-success opacity-75 mb-1">Allocated</h6>
                                <h3 className="text-success mb-0 fw-bold">{overviewStats.allocatedClasses}</h3>
                                <div className="text-success opacity-75 mt-1" style={{ fontSize: '0.65rem', lineHeight: '1.2' }}>Saved in database</div>
                            </div>
                        </div>
                    </div>
                    <div className="col-md-2 col-6">
                        <div className="card bg-warning bg-opacity-10 border-warning border-opacity-25 h-100 shadow-sm cursor-pointer" onClick={() => openStatsModal('totalRooms', 'Total Theory Rooms')} style={{ cursor: 'pointer' }}>
                            <div className="card-body py-3 text-center">
                                <h6 className="text-warning-emphasis opacity-75 mb-1">Total Rooms</h6>
                                <h3 className="text-warning-emphasis mb-0 fw-bold">{overviewStats.totalRooms}</h3>
                                <div className="text-warning-emphasis opacity-75 mt-1" style={{ fontSize: '0.65rem', lineHeight: '1.2' }}>Assigned to dept</div>
                            </div>
                        </div>
                    </div>
                    <div className="col-md-2 col-6">
                        <div className="card bg-info bg-opacity-10 border-info border-opacity-25 h-100 shadow-sm cursor-pointer" onClick={() => openStatsModal('roomsUsed', 'Rooms Used')} style={{ cursor: 'pointer' }}>
                            <div className="card-body py-3 text-center">
                                <h6 className="text-info-emphasis opacity-75 mb-1">Rooms Used</h6>
                                <h3 className="text-info-emphasis mb-0 fw-bold">{overviewStats.roomsUsed}</h3>
                                <div className="text-info-emphasis opacity-75 mt-1" style={{ fontSize: '0.65rem', lineHeight: '1.2' }}>Currently allocated</div>
                            </div>
                        </div>
                    </div>
                    <div className="col-md-2 col-6">
                        <div className="card bg-secondary bg-opacity-10 border-secondary border-opacity-25 h-100 shadow-sm cursor-pointer" onClick={() => openStatsModal('available', 'Rooms Pending (Available)')} style={{ cursor: 'pointer' }}>
                            <div className="card-body py-3 text-center">
                                <h6 className="text-secondary opacity-75 mb-1">Rooms Pending</h6>
                                <h3 className="text-secondary mb-0 fw-bold">{overviewStats.availableRooms}</h3>
                                <div className="text-secondary opacity-75 mt-1" style={{ fontSize: '0.65rem', lineHeight: '1.2' }}>Available to use</div>
                            </div>
                        </div>
                    </div>
                    <div className="col-md-2 col-6">
                        <div className="card bg-danger bg-opacity-10 border-danger border-opacity-25 h-100 shadow-sm cursor-pointer" onClick={() => openStatsModal('shared', 'Shared Rooms')} style={{ cursor: 'pointer' }}>
                            <div className="card-body py-3 text-center">
                                <h6 className="text-danger opacity-75 mb-1">Shared Rooms</h6>
                                <h3 className="text-danger mb-0 fw-bold">{overviewStats.sharedRoomsCount}</h3>
                                <div className="text-danger opacity-75 mt-1" style={{ fontSize: '0.65rem', lineHeight: '1.2' }}>No specific dept</div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="card mb-4">
                <div className="card-body">
                    <div className="row g-3">
                        <div className="col-md-4 col-sm-6">
                            <label className="form-label text-muted small fw-semibold text-uppercase mb-2">Building</label>
                            <select
                                className="form-select border-0 bg-light fw-medium"
                                value={selectedBuilding}
                                onChange={(e) => {
                                    setSelectedBuilding(e.target.value);
                                    setSelectedDepartment('all'); // Reset dept when building changes
                                }}
                            >
                                <option value="all">All Buildings</option>
                                {buildings.map(b => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                            </select>
                        </div>
                        {!isDeptAdmin && (
                            <div className="col-md-4 col-sm-6">
                                <label className="form-label text-muted small fw-semibold text-uppercase mb-2">Department</label>
                                <select
                                    className="form-select border-0 bg-light fw-medium"
                                    value={selectedDepartment}
                                    onChange={(e) => setSelectedDepartment(e.target.value)}
                                >
                                    <option value="all">All Departments</option>
                                    {(selectedBuilding === 'all'
                                        ? departments
                                        : departments.filter(d => {
                                            const b = buildings.find(bldg => bldg.id.toString() === selectedBuilding.toString());
                                            return b && b.department_ids && b.department_ids.includes(d.id);
                                        })
                                    ).map(d => (
                                        <option key={d.id} value={d.id}>{d.name} ({d.short_code})</option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div className="col-md-4 col-sm-12">
                            <label className="form-label text-muted small fw-semibold text-uppercase mb-2">Academic Session</label>
                            <select
                                className="form-select"
                                value={selectedSession}
                                onChange={(e) => setSelectedSession(e.target.value)}
                            >
                                {sessions.map(s => (
                                    <option key={s.id} value={s.id}>{s.name} {s.is_active ? '(Active)' : ''}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            <div className="card shadow-sm border-0 rounded-3">
                <div className="card-header bg-white border-bottom py-3 d-flex justify-content-between align-items-center">
                    <h5 className="mb-0 fw-bold"><i className="bi bi-magic text-warning me-2"></i> Room Suggestions</h5>
                    {sectionSuggestions.length > 0 && !loading && (
                        <div className="d-flex gap-2">
                            <button
                                className="btn btn-sm btn-outline-danger d-inline-flex align-items-center justify-content-center"
                                onClick={handleClearAll}
                                disabled={isSaving}
                                title="Clear All Allocations"
                            >
                                <i className="bi bi-eraser me-md-2"></i>
                                <span className="d-none d-md-inline">Clear All</span>
                            </button>
                            <button
                                className="btn btn-sm btn-light border d-inline-flex align-items-center justify-content-center"
                                onClick={handleRefresh}
                                disabled={isSaving}
                                title="Refresh"
                            >
                                <i className="bi bi-arrow-clockwise me-md-2"></i>
                                <span className="d-none d-md-inline">Refresh</span>
                            </button>
                            <button
                                className="btn btn-sm btn-primary shadow-sm d-inline-flex align-items-center justify-content-center"
                                onClick={handleSaveAllocations}
                                disabled={isSaving}
                            >
                                <i className="bi bi-save me-1 me-md-2"></i>
                                <span className="d-none d-md-inline">{isSaving ? 'Saving...' : 'Save All Allocations'}</span>
                                <span className="d-inline d-md-none">{isSaving ? '...' : 'Save'}</span>
                            </button>
                        </div>
                    )}
                </div>
                <div className="card-body p-0">
                    {loading ? (
                        <div className="text-center py-5 text-muted">
                            <div className="spinner-border text-primary mb-3" role="status"></div>
                            <p>Analyzing optimal room fits...</p>
                        </div>
                    ) : sectionSuggestions.length === 0 ? (
                        <div className="text-center py-5 text-muted">
                            <i className="bi bi-box-seam fs-1 mb-3 d-block text-secondary opacity-50"></i>
                            <p className="mb-0">No classes found for the selected department and session.</p>
                        </div>
                    ) : (
                        <div className="table-responsive">
                            <table className="table table-hover align-middle mb-0">
                                <thead className="table-light">
                                    <tr>
                                        <th className="px-4 py-3">Class & Section</th>
                                        <th className="py-3 text-center">Strength</th>
                                        <th className="py-3">Home Room</th>
                                        <th className="py-3 text-primary">Suggested Theory Room</th>
                                        <th className="py-3 px-4 text-center">Lab Suggestions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sectionSuggestions.map(sec => {
                                        return (
                                            <tr
                                                key={sec.id}
                                                className={`align-middle ${sec.isMergedGroup ? 'table-primary bg-opacity-25' : ''}`}
                                            >
                                                <td className="px-4">
                                                    <div className="fw-bold text-dark">{sec.display_name}</div>
                                                </td>
                                                <td className="text-center">
                                                    {editingStrength === sec.id ? (
                                                        <div className="input-group input-group-sm mx-auto" style={{ maxWidth: '120px' }}>
                                                            <input
                                                                type="number"
                                                                className="form-control text-center"
                                                                value={tempStrength}
                                                                onChange={(e) => setTempStrength(e.target.value)}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') handleUpdateStrength(sec.id);
                                                                    if (e.key === 'Escape') setEditingStrength(null);
                                                                }}
                                                                autoFocus
                                                            />
                                                            <button
                                                                className="btn btn-success"
                                                                onClick={() => handleUpdateStrength(sec.id)}
                                                                disabled={isUpdatingStrength}
                                                            >
                                                                {isUpdatingStrength ? <span className="spinner-border spinner-border-sm"></span> : <i className="bi bi-check2"></i>}
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        sec.isMergedGroup ? (
                                                            <span className="badge bg-secondary p-2">
                                                                <i className="bi bi-people-fill me-1"></i> {sec.student_strength || 0}
                                                            </span>
                                                        ) : (
                                                            <span
                                                                className="badge bg-secondary p-2"
                                                                style={{ cursor: 'pointer' }}
                                                                onClick={() => {
                                                                    setTempStrength(sec.student_strength || '');
                                                                    setEditingStrength(sec.id);
                                                                }}
                                                                title="Click to update strength"
                                                            >
                                                                <i className="bi bi-people-fill me-1"></i> {sec.student_strength || 0}
                                                                <i className="bi bi-pencil-square ms-2 opacity-75 small"></i>
                                                            </span>
                                                        )
                                                    )}
                                                </td>
                                                <td>
                                                    {sec.home_room_number ? (
                                                        <span className="text-muted fw-medium"><i className="bi bi-geo-alt-fill me-1"></i>{sec.home_room_number}</span>
                                                    ) : (
                                                        <span className="text-muted fst-italic">Not Assigned</span>
                                                    )}
                                                </td>
                                                <td>
                                                    {sec.isOnline ? (
                                                        <span className="text-info small fw-semibold"><i className="bi bi-laptop me-1"></i> Online Mode - No Room Required</span>
                                                    ) : sec.noStrength ? (
                                                        <span className="text-danger small fw-semibold"><i className="bi bi-x-circle-fill me-1"></i> Please define strength first</span>
                                                    ) : (sec.theorySugg || sec.home_room_id) ? (
                                                        <div className="mb-0">
                                                            <select
                                                                className="form-select form-select-sm border-primary mb-1 fw-semibold"
                                                                value={selectedTheoryRooms[sec.id] !== undefined ? selectedTheoryRooms[sec.id] : (sec.home_room_id || (sec.theorySugg ? sec.theorySugg.room.id : 'none'))}
                                                                onChange={(e) => {
                                                                    const val = e.target.value;
                                                                    const currentId = selectedTheoryRooms[sec.id] !== undefined ? selectedTheoryRooms[sec.id] : (sec.home_room_id || (sec.theorySugg ? sec.theorySugg.room.id : 'none'));
                                                                    const usage = currentRoomAllocations ? (currentRoomAllocations[val] || 0) : 0;
                                                                    if (val !== 'none' && usage >= 2 && val != currentId) {
                                                                        Swal.fire({
                                                                            icon: 'warning',
                                                                            title: 'Room Over-allocated',
                                                                            text: 'This room has already been allocated to 2 classes. Allocating it to more classes may cause scheduling conflicts in the timetable. A maximum of 2 classes per room is recommended.',
                                                                            confirmButtonText: 'Okay'
                                                                        });
                                                                    }
                                                                    setSelectedTheoryRooms({ ...selectedTheoryRooms, [sec.id]: val });
                                                                }}
                                                            >
                                                                <option value="none" style={{ backgroundColor: '#fff', color: '#dc3545', fontWeight: 'bold' }}>N/A (No Permanent Room)</option>
                                                                {rooms.filter(r => {
                                                                    if (r.room_type === 'lab') return false;
                                                                    // Do NOT filter out by usage so users can still see all rooms, but they get a warning.
                                                                    if (selectedDepartment && selectedDepartment !== 'all') {
                                                                        return r.department_id == selectedDepartment || !r.department_id || r.department_id == 0;
                                                                    }
                                                                    return true;
                                                                }).sort((a, b) => {
                                                                    const isSharedA = !a.department_id || a.department_id == 0;
                                                                    const isSharedB = !b.department_id || b.department_id == 0;
                                                                    if (isSharedA && !isSharedB) return 1;
                                                                    if (!isSharedA && isSharedB) return -1;
                                                                    const deptA = a.department_name || '';
                                                                    const deptB = b.department_name || '';
                                                                    if (deptA < deptB) return -1;
                                                                    if (deptA > deptB) return 1;
                                                                    return a.capacity - b.capacity;
                                                                }).map(r => {
                                                                    const isShared = !r.department_id || r.department_id == 0;
                                                                    let buildingText = (!selectedBuilding || selectedBuilding === 'all') && r.building_name ? ` (${r.building_name})` : '';
                                                                    let deptText = '';
                                                                    if (isShared) {
                                                                        deptText = ' [Shared]';
                                                                    } else if (!selectedDepartment || selectedDepartment === 'all') {
                                                                        deptText = ` [${r.department_short_code || 'Own Dept'}]`;
                                                                    }

                                                                    return (
                                                                        <option
                                                                            key={r.id}
                                                                            value={r.id}
                                                                            style={{
                                                                                backgroundColor: isShared ? '#fffbeb' : '#f0fdf4',
                                                                                color: isShared ? '#b45309' : '#15803d',
                                                                                fontWeight: 'bold'
                                                                            }}
                                                                        >
                                                                            {Number(r.is_smart_room) === 1 ? '🌟 ' : ''}{r.room_number}{buildingText} - Cap: {r.capacity}{deptText}
                                                                        </option>
                                                                    );
                                                                })}
                                                            </select>

                                                            {/* Display room type tag, warnings or capacity mismatches */}
                                                            {(() => {
                                                                const currentRoomId = selectedTheoryRooms[sec.id] !== undefined ? selectedTheoryRooms[sec.id] : (sec.home_room_id || (sec.theorySugg ? sec.theorySugg.room.id : 'none'));
                                                                if (currentRoomId === 'none') {
                                                                    return (
                                                                        <div className="mb-1 d-flex gap-1 flex-wrap mt-1">
                                                                            <span className="badge bg-danger bg-opacity-10 text-danger border border-danger small">
                                                                                <i className="bi bi-x-circle me-1"></i> Floating / Any Room
                                                                            </span>
                                                                        </div>
                                                                    );
                                                                }
                                                                const roomObj = rooms.find(r => r.id == currentRoomId);
                                                                const isSharedRoom = roomObj && (!roomObj.department_id || roomObj.department_id == 0);
                                                                const conflicts = getTheoryConflicts(currentRoomId, sec.id);

                                                                let bufferRatio = 0.85;
                                                                const semNum = parseInt(sec.semester, 10);
                                                                if (!isNaN(semNum) && semNum > 5) {
                                                                    bufferRatio = 0.75;
                                                                }
                                                                const adjustedStrength = (sec.student_strength || 0) * bufferRatio;

                                                                return (
                                                                    <>
                                                                        {roomObj && (
                                                                            <div className="mb-1 d-flex gap-1 flex-wrap">
                                                                                {isSharedRoom ? (
                                                                                    <span className="badge bg-warning text-dark border border-warning small"><i className="bi bi-diagram-3-fill me-1"></i>Shared Room</span>
                                                                                ) : (
                                                                                    <span className="badge bg-success text-white border border-success small"><i className="bi bi-building-check me-1"></i>{roomObj.department_short_code || roomObj.department_name || 'Own Dept'}</span>
                                                                                )}
                                                                                {Number(roomObj.is_smart_room) === 1 && (
                                                                                    <span className="badge bg-primary text-white border border-primary small"><i className="bi bi-projector-fill me-1"></i>Smart Room</span>
                                                                                )}
                                                                            </div>
                                                                        )}
                                                                        {roomObj && roomObj.capacity < adjustedStrength && (
                                                                            <div className="text-danger small fst-italic mt-1"><i className="bi bi-exclamation-triangle me-1"></i>Room capacity is smaller than allowed margin</div>
                                                                        )}
                                                                        {(() => {
                                                                            const uiConflicts = getTheoryConflicts(currentRoomId, sec.id);
                                                                            const dbConflicts = roomObj && roomObj.theory_allocated_classes ? roomObj.theory_allocated_classes.split(', ') : [];
                                                                            const filteredDbConflicts = dbConflicts.filter(dbStr => {
                                                                                const cleanDbStr = dbStr.replace(/ [A-Z0-9]+$/, '');
                                                                                return !uiConflicts.some(uiStr => dbStr.includes(uiStr) || uiStr.includes(cleanDbStr));
                                                                            });
                                                                            const allConflicts = [...uiConflicts, ...filteredDbConflicts];
                                                                            if (allConflicts.length === 0) return null;

                                                                            return (
                                                                                <div className="alert alert-info small py-1 px-2 mt-1 mb-0 border-0">
                                                                                    <div className="mb-1">
                                                                                        <i className="bi bi-info-circle-fill me-1"></i>
                                                                                        <strong>Current Saved Class Room:</strong> Also allocated to:
                                                                                    </div>
                                                                                    <div className="d-flex flex-wrap gap-1">
                                                                                        {allConflicts.slice(0, 4).map((c, i) => <span key={i} className="badge bg-info bg-opacity-10 text-info-emphasis border border-info-subtle">{c}</span>)}
                                                                                        {allConflicts.length > 4 && <span className="badge bg-secondary bg-opacity-10 text-secondary border border-secondary">+{allConflicts.length - 4} more</span>}
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })()}
                                                                    </>
                                                                );
                                                            })()}
                                                            
                                                            {/* Suggestion Button if overridden by DB */}
                                                            {sec.theorySugg && (selectedTheoryRooms[sec.id] !== undefined ? selectedTheoryRooms[sec.id] : sec.home_room_id) != sec.theorySugg.room.id && (
                                                                <div className="mt-2 text-end">
                                                                    <button 
                                                                        className="btn btn-sm btn-outline-primary py-0 px-2 rounded-pill shadow-sm bg-white" 
                                                                        style={{ fontSize: '0.75rem' }}
                                                                        onClick={() => setSelectedTheoryRooms({ ...selectedTheoryRooms, [sec.id]: sec.theorySugg.room.id })}
                                                                        title="Apply smart suggestion"
                                                                    >
                                                                        <i className="bi bi-magic me-1 text-warning"></i> Suggest: {sec.theorySugg.room.room_number}
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="text-danger small"><i className="bi bi-exclamation-circle me-1"></i> No theory rooms available</span>
                                                    )}
                                                </td>
                                                <td className="px-4 text-center">
                                                    <button
                                                        className="btn btn-outline-primary btn-sm rounded-pill px-3 fw-medium"
                                                        onClick={() => handleViewLabs(sec)}
                                                        disabled={sec.noStrength || sec.isOnline}
                                                    >
                                                        <i className="bi bi-pc-display me-1"></i> View Labs
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {/* Stats Details Modal */}
            {statsModal.show && (
                <div className="modal fade show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050 }} tabIndex="-1">
                    <div className="modal-dialog modal-lg modal-dialog-scrollable modal-dialog-centered">
                        <div className="modal-content border-0 shadow-lg">
                            <div className="modal-header bg-light d-flex justify-content-between align-items-center">
                                <h5 className="modal-title fw-bold m-0 text-dark">
                                    <i className="bi bi-info-circle text-primary me-2"></i> {statsModal.title}
                                </h5>
                                <button type="button" className="btn-close" onClick={() => setStatsModal({ ...statsModal, show: false })}></button>
                            </div>
                            <div className="modal-body p-0">
                                {statsModal.data.length === 0 ? (
                                    <div className="text-center py-5 text-muted">No details available.</div>
                                ) : (
                                    <div className="table-responsive">
                                        <table className="table table-hover align-middle mb-0">
                                            <thead className="table-light">
                                                <tr>
                                                    {['total', 'allocated', 'pending', 'online'].includes(statsModal.type) ? (
                                                        <>
                                                            <th className="px-4 py-3" style={{ width: '60px' }}>S.No.</th>
                                                            <th className="py-3">Class & Section</th>
                                                            <th className="py-3">Strength</th>
                                                            <th className="py-3">Current Status</th>
                                                            <th className="py-3">Room</th>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <th className="px-4 py-3" style={{ width: '60px' }}>S.No.</th>
                                                            <th className="py-3">Room Number</th>
                                                            <th className="py-3">Capacity</th>
                                                            <th className="py-3">Department</th>
                                                            <th className="py-3">Building</th>
                                                            <th className="py-3">Allocated To</th>
                                                        </>
                                                    )}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {statsModal.data.map((item, idx) => {
                                                    let rowClass = "";
                                                    let allConflicts = [];
                                                    let totalAllocations = 0;
                                                    const isSectionTable = ['total', 'allocated', 'pending', 'online'].includes(statsModal.type);
                                                    const roomId = isSectionTable ? item.home_room_id : item.id;
                                                    
                                                    if (roomId) {
                                                        const room = rooms.find(r => r.id === roomId);
                                                        if (room) {
                                                            const uiConflicts = sectionSuggestions.filter(s => {
                                                                const sSelectedId = selectedTheoryRooms[s.id] || s.home_room_id || (s.theorySugg?.room?.id);
                                                                return sSelectedId == room.id;
                                                            });
                                                            const dbConflicts = room.theory_allocated_classes ? room.theory_allocated_classes.split(', ') : [];
                                                            const uiConflictNames = uiConflicts.map(s => s.display_name);
                                                            const filteredDbConflicts = dbConflicts.filter(dbStr => {
                                                                const cleanDbStr = dbStr.replace(/ [A-Z0-9]+$/, '');
                                                                return !uiConflictNames.some(uiStr => dbStr.includes(uiStr) || uiStr.includes(cleanDbStr));
                                                            });
                                                            
                                                            allConflicts = [...uiConflictNames, ...filteredDbConflicts];
                                                            totalAllocations = allConflicts.length;
                                                            
                                                            const isShared = !room.department_id || room.department_id == 0;
                                                            
                                                            if (totalAllocations > 1) {
                                                                rowClass = "table-warning";
                                                            } else if (isShared) {
                                                                rowClass = "table-info";
                                                            }
                                                        }
                                                    }

                                                    return (
                                                        <tr key={idx} className={rowClass}>
                                                            {isSectionTable ? (
                                                                <>
                                                                <td className="px-4 py-3 text-muted">{idx + 1}</td>
                                                                <td className="py-3 fw-medium">
                                                                    {item.display_name}
                                                                </td>
                                                                <td className="py-3 text-muted">{item.student_strength || 'N/A'}</td>
                                                                <td className="py-3">
                                                                    {item.isOnline ? (
                                                                        <span className="badge bg-info text-dark">Online</span>
                                                                    ) : item.noStrength ? (
                                                                        <span className="badge bg-secondary">Not Required</span>
                                                                    ) : item.home_room_id ? (
                                                                        <span className="badge bg-success text-white">Allocated</span>
                                                                    ) : (
                                                                        <span className="badge bg-warning text-dark">Pending</span>
                                                                    )}
                                                                </td>
                                                                <td className="py-3 text-muted">
                                                                    {item.home_room_number ? (
                                                                        <div>
                                                                            <span>
                                                                                {item.home_room_number} 
                                                                                <span className="small ms-1 opacity-75">
                                                                                    (Cap: {rooms.find(r => r.id === item.home_room_id)?.capacity || 'N/A'})
                                                                                </span>
                                                                            </span>
                                                                            {totalAllocations > 1 && (
                                                                                <div className="small mt-1 text-danger fw-bold">
                                                                                    Shared with: {allConflicts.filter(c => c !== item.display_name).join(', ')}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    ) : '-'}
                                                                </td>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <td className="px-4 py-3 text-muted">{idx + 1}</td>
                                                                <td className="py-3 fw-medium">
                                                                    <i className="bi bi-door-open text-primary me-2"></i>{item.room_number}
                                                                </td>
                                                                <td className="py-3 text-muted">{item.capacity}</td>
                                                                <td className="py-3">
                                                                    {(!item.department_id || item.department_id == 0) ? (
                                                                        <span className="badge bg-danger bg-opacity-10 text-danger border border-danger border-opacity-25">Shared Room</span>
                                                                    ) : (
                                                                        <span className="text-muted fw-medium">{item.department_short_code || departments?.find(d => d.id == item.department_id)?.short_code || item.department_name || 'Unknown'}</span>
                                                                    )}
                                                                </td>
                                                                <td className="py-3">
                                                                    <span className="badge bg-light text-dark border">{item.building_name || 'N/A'}</span>
                                                                </td>
                                                                <td className="py-3">
                                                                    <div className="d-flex flex-wrap gap-1">
                                                                        {(() => {
                                                                            const uiConflicts = getTheoryConflicts(item.id, null);
                                                                            const dbConflicts = item.theory_allocated_classes ? item.theory_allocated_classes.split(', ') : [];
                                                                            const filteredDbConflicts = dbConflicts.filter(dbStr => {
                                                                                const cleanDbStr = dbStr.replace(/ [A-Z0-9]+$/, '');
                                                                                return !uiConflicts.some(uiStr => dbStr.includes(uiStr) || uiStr.includes(cleanDbStr));
                                                                            });
                                                                            const allConflicts = [...uiConflicts, ...filteredDbConflicts];
                                                                            if (allConflicts.length === 0) return <span className="text-muted fst-italic">None</span>;
                                                                            return allConflicts.map((c, i) => (
                                                                                <span key={i} className="badge bg-info bg-opacity-10 text-info-emphasis border border-info-subtle">{c}</span>
                                                                            ));
                                                                        })()}
                                                                    </div>
                                                                </td>
                                                            </>
                                                        )}
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Lab Suggestions Modal */}
            {showLabModal && activeSection && (
                <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)' }}>
                    <div className="modal-dialog modal-dialog-centered modal-lg">
                        <div className="modal-content border-0 shadow-lg">
                            <div className="modal-header border-bottom-0 pb-0">
                                <div>
                                    <h5 className="modal-title fw-bold">Lab Suggestions</h5>
                                    <h6 className="text-muted small mb-4">For {activeSection?.display_name} (Strength: {activeSection?.student_strength || 0})</h6>
                                </div>
                                <button type="button" className="btn-close" onClick={() => setShowLabModal(false)}></button>
                            </div>
                            <div className="modal-body py-4">
                                {activeSection.labSubjectSuggs && activeSection.labSubjectSuggs.length > 0 ? (
                                    <div className="accordion" id="labSubjectsAccordion">
                                        {activeSection.labSubjectSuggs.map((labSubj, subjIdx) => {
                                            const isExpanded = expandedLabSubject === null ? subjIdx === 0 : expandedLabSubject === labSubj.subject.id + '_all';
                                            return (
                                                <div className="accordion-item mb-3 border-0 shadow-sm rounded overflow-hidden" key={labSubj.subject.id + '_all'}>
                                                    <h2 className="accordion-header">
                                                        <button
                                                            className={`accordion-button ${!isExpanded ? 'collapsed' : ''} bg-light fw-bold`}
                                                            type="button"
                                                            onClick={() => setExpandedLabSubject(isExpanded ? 'none' : labSubj.subject.id + '_all')}
                                                        >
                                                            <i className="bi bi-journal-code text-primary me-2 fs-5"></i>
                                                            {labSubj.subject.full_name} ({labSubj.subject.short_code})
                                                        </button>
                                                    </h2>
                                                    <div className={`accordion-collapse collapse ${isExpanded ? 'show' : ''}`}>
                                                        <div className="accordion-body pb-2 pt-3">
                                                            {labSubj.suggestions.length === 0 ? (
                                                                <div className="alert alert-danger py-2">
                                                                    <i className="bi bi-exclamation-triangle-fill me-2"></i> No lab rooms available in this department.
                                                                </div>
                                                            ) : (
                                                                <div>
                                                                    {!labSubj.isFit && (
                                                                        <div className="alert alert-warning py-2 mb-3 small border-0">
                                                                            <i className="bi bi-info-circle-fill me-2"></i> No lab is large enough. Suggesting largest available.
                                                                        </div>
                                                                    )}
                                                                    <div className="row g-3">
                                                                        {labSubj.suggestions.map((lab, idx) => {
                                                                            const defaultLabId = labSubj.subject.saved_room_id || (labSubj.suggestions[0]?.id);
                                                                            const keyForLab = `${activeSection.id}_${labSubj.subject.id}_all`;
                                                                            const isSelected = (selectedLabRooms[keyForLab] == lab.id) ||
                                                                                (!selectedLabRooms[keyForLab] && lab.id == defaultLabId);
                                                                            const conflicts = getLabConflicts(lab.id, activeSection.id, labSubj.subject.id);

                                                                            return (
                                                                                <div className="col-md-6" key={lab.id}>
                                                                                    {(() => {
                                                                                        const isSharedLab = !lab.department_id || lab.department_id == 0;
                                                                                        return (
                                                                                            <div
                                                                                                className={`card h-100 border cursor-pointer ${isSelected ? (isSharedLab ? 'border-warning shadow bg-warning bg-opacity-10' : 'border-success shadow bg-success bg-opacity-10') : (isSharedLab ? 'border-warning-subtle bg-warning-subtle bg-opacity-25' : 'border-success-subtle bg-success-subtle bg-opacity-25')}`}
                                                                                                onClick={() => setSelectedLabRooms({ ...selectedLabRooms, [keyForLab]: lab.id })}
                                                                                                style={{ cursor: 'pointer', borderWidth: isSelected ? '2px' : '1px' }}
                                                                                            >
                                                                                                <div className="card-body p-3">
                                                                                                    <div className="d-flex justify-content-between align-items-center mb-1">
                                                                                                        <div className="fw-bold fs-6 text-dark d-flex align-items-center">
                                                                                                            <div className={`form-check form-check-inline m-0 me-2`}>
                                                                                                                <input className="form-check-input cursor-pointer" type="radio" checked={isSelected} readOnly />
                                                                                                            </div>
                                                                                                            <i className="bi bi-pc-display-horizontal text-primary me-2"></i>{Number(lab.is_smart_room) === 1 ? '🌟 ' : ''}{lab.room_number}{(!selectedBuilding || selectedBuilding === 'all') && lab.building_name ? ` (${lab.building_name})` : ''}
                                                                                                        </div>
                                                                                                        <div className="d-flex gap-1 align-items-center">
                                                                                                            {isSharedLab ? (
                                                                                                                <span className="badge bg-warning text-dark border border-warning small"><i className="bi bi-diagram-3-fill me-1"></i>Shared</span>
                                                                                                            ) : (
                                                                                                                (!selectedDepartment || selectedDepartment === 'all') && (
                                                                                                                    <span className="badge bg-success text-white border border-success small"><i className="bi bi-building-check me-1"></i>{lab.department_short_code || lab.department_name || 'Own Dept'}</span>
                                                                                                                )
                                                                                                            )}
                                                                                                            {Number(lab.is_smart_room) === 1 && (
                                                                                                                <span className="badge bg-primary text-white border border-primary small"><i className="bi bi-projector-fill me-1"></i>Smart Room</span>
                                                                                                            )}
                                                                                                            {idx === 0 && <span className="badge bg-secondary rounded-pill" style={{ fontSize: '0.7rem' }}>Best Match</span>}
                                                                                                        </div>
                                                                                                    </div>
                                                                                                    <div className="text-muted small ms-4">
                                                                                                        Capacity: <strong>{lab.capacity}</strong> | Total Usage: <strong>{lab.lab_allocation_count || 0}</strong>
                                                                                                    </div>
                                                                                                    {isSelected && conflicts.length > 0 && (
                                                                                                        <div className="text-danger small fw-semibold mt-2 ms-4">
                                                                                                            <div className="mb-1"><i className="bi bi-exclamation-circle-fill me-1"></i>Also allocated to:</div>
                                                                                                            <div className="d-flex flex-wrap gap-1">
                                                                                                                {conflicts.slice(0, 4).map((c, i) => <span key={i} className="badge bg-danger bg-opacity-10 text-danger border border-danger">{c}</span>)}
                                                                                                                {conflicts.length > 4 && <span className="badge bg-secondary bg-opacity-10 text-secondary border border-secondary">+{conflicts.length - 4} more</span>}
                                                                                                            </div>
                                                                                                        </div>
                                                                                                    )}
                                                                                                </div>
                                                                                            </div>
                                                                                        );
                                                                                    })()}
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-center py-4 text-muted">
                                        <i className="bi bi-journal-x fs-1 mb-2 d-block text-secondary opacity-50"></i>
                                        <p>No lab subjects found for this program and semester.</p>
                                    </div>
                                )}
                            </div>
                            <div className="modal-footer border-top-0 bg-light rounded-bottom">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowLabModal(false)}>Close</button>
                                <button type="button" className="btn btn-primary" onClick={() => {
                                    setShowLabModal(false);
                                    toast.success('Lab selections saved temporarily. Click "Save All Allocations" to confirm.', { autoClose: 3000 });
                                }}>
                                    <i className="bi bi-check-circle me-1"></i> Save
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SmartRoomAllocator;
