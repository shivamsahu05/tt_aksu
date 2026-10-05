import React, { useState, useEffect, useRef, useMemo } from 'react';
import { toast } from 'react-toastify';
import api from '../../utils/api';
import PageHeader from '../../components/common/PageHeader';
import DataTable from '../../components/common/DataTable';
import XLSX from 'xlsx-js-style';
import Swal from 'sweetalert2';
import TeacherConstraintsModal from '../../components/timetable/TeacherConstraintsModal';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useReactToPrint } from 'react-to-print';
import logoImg from '../../assets/logo.png';

const formatRoomName = (entry) => {
    if (!entry || !entry.room_number) return null;
    if (entry.room_building_id && entry.class_building_id && entry.room_building_id !== entry.class_building_id) {
        return `${entry.room_number} - ${entry.room_building_name || 'Other Block'}`;
    }
    return entry.room_number;
};


const isNptelSubject = (item) => {
    if (!item) return false;
    return Number(item.is_nptel) === 1 ||
        String(item.subject_code || '').toUpperCase().includes('NPTEL') ||
        String(item.subject_name || '').toUpperCase().includes('NPTEL') ||
        String(item.subject_code || '').toUpperCase().includes('MOOC') ||
        String(item.subject_name || '').toUpperCase().includes('MOOC') ||
        String(item.subject_code || '').toUpperCase().includes('SWAYAM') ||
        String(item.subject_name || '').toUpperCase().includes('SWAYAM');
};

const isRemedialEntry = (e) => {
    if (!e) return false;
    const name = String(e.subject_name || '').toLowerCase();
    const code = String(e.subject_code || '').toUpperCase();
    return name.includes('remedial') || code === 'REM' || code === 'REMEDIAL';
};

const isSelfLearningEntry = (e) => {
    if (!e) return false;
    const name = String(e.subject_name || '').toLowerCase();
    const code = String(e.subject_code || '').toUpperCase();
    return name.includes('self learning') || code === 'SL';
};

const isLibraryEntry = (e) => {
    if (!e) return false;
    // Primary check: the scheduler sets isLibrary=true on placeholder library slots
    if (e.isLibrary === true) return true;
    const code = String(e.subject_code || '').toUpperCase().trim();
    const name = String(e.subject_name || '').toLowerCase().trim();
    // Only exact matches to avoid matching 'Library and information services' (LIS)
    return code === 'LIB' || name === 'library period' || name === 'library';
};


const DailyTimetable = () => {
    const [logoBase64, setLogoBase64] = useState(null);
    const [orientation, setOrientation] = useState('landscape');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [sessions, setSessions] = useState([]);
    const [selectedSession, setSelectedSession] = useState('');
    const [departments, setDepartments] = useState([]);
    const [selectedDepartment, setSelectedDepartment] = useState('');
    const [timetable, setTimetable] = useState([]);
    const [loading, setLoading] = useState(false);
    const [dayName, setDayName] = useState('');
    const [schema, setSchema] = useState(null);
    const orientationRef = useRef(orientation);
    useEffect(() => { orientationRef.current = orientation; }, [orientation]);

    const [departmentSections, setDepartmentSections] = useState([]);
    const [currentPage, setCurrentPage] = useState(1);

    const printRef = useRef();

    const generatedDateStr = useMemo(() => {
        if (!timetable || timetable.length === 0) return new Date().toLocaleString('en-IN');
        const dates = timetable.map(t => new Date(t.created_at || t.updated_at).getTime()).filter(t => !isNaN(t));
        if (dates.length > 0) {
            return new Date(Math.max(...dates)).toLocaleString('en-IN');
        }
        return new Date().toLocaleString('en-IN');
    }, [timetable]);

    useEffect(() => {
        const loadLogo = async () => {
            try {
                const response = await fetch(logoImg);
                const blob = await response.blob();
                const reader = new FileReader();
                reader.onloadend = () => { setLogoBase64(reader.result); };
                reader.readAsDataURL(blob);
            } catch (e) { console.error("Error loading logo", e); }
        };
        loadLogo();
    }, []);

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: `Daily_Timetable_Report_${date}`,
        pageStyle: () => `@page { size: ${orientationRef.current}; margin: 5mm; }`,
    });

    const handleDownloadPDF = () => {
        if (timetable.length === 0) return toast.warning('No data to export');
        
        const doc = new jsPDF(orientation === 'landscape' ? 'l' : 'p', 'mm', 'a3');
        const printDate = new Date().toLocaleString('en-IN');
        const tables = document.querySelectorAll('.daily-timetable-table');

        if (tables.length > 0) {
            tables.forEach((table, idx) => {
                if (idx > 0) doc.addPage();
                
                const currentDeptName = table.getAttribute('data-dept') || (selectedDepartment ? (departments.find(d => d.id == selectedDepartment)?.name || 'Department') : 'All Departments');

                let startX = 14;
                if (logoBase64) {
                    doc.addImage(logoBase64, 'PNG', 14, 10, 18, 18);
                    startX = 36;
                }

                doc.setFontSize(18);
                doc.setTextColor(30, 58, 138); // Primary Blue
                doc.text("AKS University", startX, 17);

                doc.setTextColor(0, 0, 0);
                doc.setFontSize(14);
                doc.text(`Daily Engagements & Timetable - ${currentDeptName}`, startX, 24);

                doc.setFontSize(10);
                doc.setTextColor(100, 100, 100);
                doc.text(`Generated on: ${generatedDateStr} | Printed on: ${printDate} | Date: ${date} (${dayName})`, startX, 29);

                autoTable(doc, {
                    html: table,
                    startY: 33,
                    theme: 'grid',
                    useCss: false,
                    styles: { fontSize: 8, cellPadding: 2, halign: 'center', valign: 'middle', lineColor: [200, 200, 200], lineWidth: 0.1 },
                    headStyles: { fillColor: [30, 58, 138], textColor: [255, 255, 255], fontStyle: 'bold' },
                    didParseCell: function (data) {
                        if (data.section === 'body') {
                            if (data.cell.raw && data.cell.raw instanceof HTMLElement) {
                                let textStr = data.cell.raw.innerText || '';
                                
                                let lines = textStr.split('\n')
                                    .map(l => l.trim())
                                    .filter(l => l.length > 0 && l.toUpperCase() !== 'ENGAGE');

                                const rawHtml = data.cell.raw.outerHTML || '';
                                
                                if (rawHtml.includes('bg-warning')) {
                                    data.cell.styles.fillColor = [255, 193, 7];
                                    data.cell.styles.textColor = [0, 0, 0];
                                    if (lines.length >= 2) lines.splice(lines.length - 1, 0, '[ENGAGED]');
                                } else if (rawHtml.includes('table-danger') || rawHtml.includes('btn-danger')) {
                                    data.cell.styles.fillColor = [254, 226, 226];
                                    if (lines.length >= 2) lines.push('[ON LEAVE]');
                                } else if (rawHtml.includes('table-success')) {
                                    data.cell.styles.fillColor = [187, 247, 208];
                                } else if (rawHtml.includes('table-primary')) {
                                    data.cell.styles.fillColor = [224, 242, 254];
                                } else if (textStr.toUpperCase().includes('LUNCH') || textStr.toUpperCase().includes('BREAK')) {
                                    data.cell.styles.fillColor = [254, 240, 138];
                                    data.cell.styles.textColor = [133, 77, 14];
                                }

                                data.cell.text = lines;

                                if (lines.length > 0 && lines[0] !== '-' && !textStr.toUpperCase().includes('LUNCH')) {
                                    data.cell.styles.fontSize = 9;
                                    data.cell.styles.fontStyle = 'bold';
                                } else if (textStr.toUpperCase().includes('LUNCH')) {
                                    data.cell.styles.fontSize = 10;
                                    data.cell.styles.fontStyle = 'bold';
                                }
                            }
                        }
                    }
                });
            });
        }

        doc.save(`Daily_Timetable_Report_${date}.pdf`);
    };



    // Modal State
    const [showEngageModal, setShowEngageModal] = useState(false);
    const [engageData, setEngageData] = useState(null);
    const [substitutes, setSubstitutes] = useState([]);
    const [loadingSubs, setLoadingSubs] = useState(false);

    const getShortSubjectName = (name) => {
        if (!name) return '';
        const clean = String(name).trim();
        if (clean.length <= 15) return clean;
        const stopWords = new Set(['and', 'of', 'in', 'for', 'the', 'a', 'to', 'lab']);
        const words = clean.replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/);
        const acronym = words
            .filter(w => w.length > 0 && !stopWords.has(w.toLowerCase()))
            .map(w => w[0].toUpperCase())
            .join('');
        return acronym.length > 0 ? acronym : clean.substring(0, 15) + '...';
    };
    const [selectedSub, setSelectedSub] = useState('');
    const [assigning, setAssigning] = useState(false);

    // Daily Regeneration & Constraints State
    const [showConstraintsModal, setShowConstraintsModal] = useState(false);
    const [showUnavailableModal, setShowUnavailableModal] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [historyList, setHistoryList] = useState([]);
    const [unavailableClasses, setUnavailableClasses] = useState([]);
    const [unavailableTeachers, setUnavailableTeachers] = useState([]);
    const [allTeachers, setAllTeachers] = useState([]);

    useEffect(() => {
        const fetchAllTeachers = async () => {
            if (!selectedDepartment) {
                setAllTeachers([]);
                return;
            }
            try {
                const params = { limit: 1000, department_id: selectedDepartment };
                const res = await api.get('/teachers', { params });
                if (res.data.success) setAllTeachers(res.data.data);
            } catch (err) {
                console.error('Error fetching teachers:', err);
            }
        };
        fetchAllTeachers();
    }, [selectedDepartment]);

    const handleRegenerateToday = async () => {
        if (!selectedDepartment) {
            return toast.warning('Please select a specific Department first to regenerate timetable.');
        }
        if (!selectedSession || !date) {
            return toast.error('Please select an active academic session and date');
        }

        const res1 = await Swal.fire({
            title: "Regenerate Today's Timetable?",
            text: `Are you sure you want to regenerate the timetable only for ${dayName || date}? This will recreate the schedule for only this specific day based on active constraints.`,
            icon: "warning",
            showCancelButton: true,
            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#d33",
            confirmButtonText: "Yes, continue (1/2)"
        });

        if (!res1.isConfirmed) return;

        const res2 = await Swal.fire({
            title: "Final Confirmation (2/2)",
            text: `Regenerating today's timetable (${dayName || date}) will overwrite today's existing classes. Do you want to proceed with regeneration?`,
            icon: "warning",
            showCancelButton: true,
            confirmButtonColor: "#d33",
            cancelButtonColor: "#6c757d",
            confirmButtonText: "Yes, Regenerate Now!"
        });

        if (!res2.isConfirmed) return;

        try {
            setLoading(true);
            const res = await api.post('/timetable/regenerate-daily', {
                session_id: selectedSession,
                department_id: selectedDepartment || null,
                date: date,
                unavailable_classes: unavailableClasses,
                unavailable_teachers: unavailableTeachers
            });
            if (res.data.success) {
                toast.success(res.data.message || 'Timetable regenerated successfully for today');
                fetchDailyTimetable();
            }
        } catch (error) {
            toast.error(error.response?.data?.message || "Failed to regenerate today's timetable");
        } finally {
            setLoading(false);
        }
    };

    const handleOpenHistory = async () => {
        if (!selectedDepartment) {
            return toast.warning('Please select a specific Department first.');
        }
        try {
            const res = await api.get('/timetable/daily-history');
            if (res.data.success) {
                setHistoryList(res.data.data);
                setShowHistoryModal(true);
            }
        } catch (error) {
            toast.error('Failed to load regeneration history');
        }
    };

    useEffect(() => {
        fetchSessions();
        fetchDepartments();
        fetchSchema();
    }, []);

    const fetchSchema = async () => {
        try {
            const res = await api.get(`/timetable/schema${selectedDepartment ? `?department_id=${selectedDepartment}` : ''}`);
            if (res.data.success) setSchema(res.data.data);
        } catch (error) {
            toast.error('Failed to load timetable schema');
        }
    };

    useEffect(() => {
        if (selectedSession && date) {
            fetchDailyTimetable();
        }
        fetchSchema();
    }, [selectedSession, date, selectedDepartment]);

    useEffect(() => {
        if (selectedSession) {
            fetchDepartmentSections();
        } else {
            setDepartmentSections([]);
        }
    }, [selectedSession, selectedDepartment]);

    const fetchDepartmentSections = async () => {
        try {
            const res = await api.get(`/classes/all-sections?department_id=${selectedDepartment || ""}&session_id=${selectedSession}`);
            if (res.data.success) {
                setDepartmentSections(res.data.data || []);
            }
        } catch (error) {
            console.error('Failed to load department sections');
        }
    };

    const fetchSessions = async () => {
        try {
            const res = await api.get('/sessions');
            setSessions(res.data.data);
            const active = res.data.data.find(s => s.is_active);
            if (active) setSelectedSession(active.id);
            else if (res.data.data.length > 0) setSelectedSession(res.data.data[0].id);
        } catch (error) {
            toast.error('Failed to load sessions');
        }
    };

    const fetchDepartments = async () => {
        try {
            const res = await api.get('/departments');
            setDepartments(res.data.data);
        } catch (error) {
            toast.error('Failed to load departments');
        }
    };

    const fetchAllTeachers = async () => {
        try {
            const res = await api.get('/teachers');
            setAllTeachers(res.data.data);
        } catch (error) {
            toast.error('Failed to load teachers');
        }
    };

    const fetchDailyTimetable = async () => {
        if (!selectedSession || !date) return;
        setLoading(true);
        try {
            let url = `/timetable/daily?date=${date}&session_id=${selectedSession}`;
            if (selectedDepartment) {
                url += `&department_id=${selectedDepartment}`;
            }
            const res = await api.get(url);
            if (res.data.success) {
                setTimetable(res.data.data);
                setCurrentPage(1);
                if (res.data.day_name) setDayName(res.data.day_name);
            }
        } catch (error) {
            toast.error('Failed to load daily timetable');
        } finally {
            setLoading(false);
        }
    };

    const handleEngageClick = async (slot) => {
        setEngageData(slot);
        setShowEngageModal(true);
        setSubstitutes([]);
        setSelectedSub('');
        setLoadingSubs(true);
        try {
            const res = await api.get(`/replacements/suggestions`, {
                params: {
                    session_id: selectedSession,
                    day_id: slot.day_id,
                    time_slot_id: slot.time_slot_id,
                    absent_teacher_id: slot.teacher_id
                }
            });
            const validSubs = (res.data.data || []).filter(t =>
                !/class\s*teacher/i.test(t.full_name || '') &&
                !/class\s*teacher/i.test(t.short_name || '') &&
                !/class\s*teacher/i.test(t.designation || '')
            );
            setSubstitutes(validSubs);
            if (validSubs.length > 0) setSelectedSub(validSubs[0].id);
        } catch (error) {
            toast.error('Failed to load substitutes');
        } finally {
            setLoadingSubs(false);
        }
    };

    const handleAssignSubstitute = async () => {
        if (!selectedSub) return toast.warning('Please select a substitute teacher');

        try {
            setAssigning(true);
            await api.post('/replacements', {
                leave_id: engageData.leave_id || null, // Will be null if auto-creating
                absent_teacher_id: engageData.teacher_id,
                date: date,
                substitute_teacher_id: selectedSub,
                timetable_id: engageData.id,
                day_id: engageData.day_id,
                time_slot_id: engageData.time_slot_id
            });
            toast.success('Replacement assigned successfully');
            setShowEngageModal(false);
            fetchDailyTimetable();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to assign replacement');
        } finally {
            setAssigning(false);
        }
    };

    const handleClearEngage = async (slot) => {
        if (!slot.replacement_id) return toast.error('No replacement found to clear');

        const result = await Swal.fire({
            title: 'Clear Engage?',
            text: "Are you sure you want to remove the assigned substitute?",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Yes, clear it!'
        });

        if (result.isConfirmed) {
            try {
                setLoading(true);
                const res = await api.delete(`/replacements/${slot.replacement_id}`);
                if (res.data.success) {
                    toast.success('Substitute cleared successfully');
                    fetchDailyTimetable();
                }
            } catch (error) {
                toast.error(error.response?.data?.message || 'Failed to clear substitute');
            } finally {
                setLoading(false);
            }
        }
    };

    const handleClearAllEngagements = async () => {
        const engagedSlots = timetable.filter(t => t.replacement_id);
        
        if (engagedSlots.length === 0) {
            return toast.info('No substitute engagements found to clear.');
        }

        let htmlContent = `
            <div style="text-align: left; max-height: 200px; overflow-y: auto; font-size: 13px; margin-top: 10px; border: 1px solid #ddd; padding: 10px; border-radius: 5px;">
                <p style="margin-bottom: 5px; font-weight: bold;">The following engagements will be cleared:</p>
                <ul style="padding-left: 20px; margin-bottom: 0;">
                    ${engagedSlots.map(t => {
                        const className = `${t.program_name} ${t.semester} ${t.section_name}`;
                        const subName = t.replacement_teacher_name || t.replacement_teacher_short_name || 'Substitute';
                        const origName = t.teacher_name || 'Original Teacher';
                        return `<li><b>${className}</b>: ${origName} ➔ <b style="color: #d33;">${subName}</b></li>`;
                    }).join('')}
                </ul>
            </div>
            <p style="margin-top: 15px; font-size: 14px; margin-bottom: 0;">Are you sure you want to clear ALL these assignments? This action cannot be undone.</p>
        `;

        const result = await Swal.fire({
            title: 'Clear All Engagements?',
            html: htmlContent,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Yes, clear all!'
        });

        if (result.isConfirmed) {
            try {
                setLoading(true);
                let url = `/replacements/daily/all?date=${date}`;
                if (selectedDepartment) {
                    url += `&department_id=${selectedDepartment}`;
                }
                const res = await api.delete(url);
                if (res.data.success) {
                    toast.success(res.data.message || 'All engagements cleared successfully');
                    fetchDailyTimetable();
                }
            } catch (error) {
                toast.error(error.response?.data?.message || 'Failed to clear all engagements');
            } finally {
                setLoading(false);
            }
        }
    };

    const exportToExcel = () => {
        if (timetable.length === 0) return toast.warning('No data to export');
        if (!schema?.slots) return toast.warning('Timetable schema not loaded');

        const deptName = selectedDepartment
            ? (departments.find(d => d.id == selectedDepartment)?.name || 'Department')
            : 'All Departments';

        let sectionsToExport = departmentSections;
        if (!sectionsToExport || sectionsToExport.length === 0) {
            const secMap = new Map();
            timetable.forEach(t => {
                if (!secMap.has(t.section_id)) {
                    secMap.set(t.section_id, {
                        id: t.section_id,
                        class_id: t.class_id || t.section_id,
                        program_name: t.program_name,
                        semester: t.semester,
                        section_name: t.section_name,
                        room_number: t.room_number,
                        student_strength: t.student_strength || '-',
                        capacity: t.capacity || '-'
                    });
                }
            });
            sectionsToExport = Array.from(secMap.values());
        }

        const aoaData = [];

        const downloadDateTime = new Date().toLocaleString('en-IN', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: true
        });

        // Title & Header Info
        aoaData.push(['DAILY ENGAGEMENTS & TIMETABLE REPORT']);
        const subtitleRow = [
            `Department: ${deptName}`,
            `Timetable Date: ${date} (${dayName || ''})`,
            `Generated At: ${generatedDateStr} | Downloaded At: ${downloadDateTime}`
        ];
        while (subtitleRow.length <= schema.slots.length + 2) {
            subtitleRow.push('');
        }
        aoaData.push(subtitleRow);
        aoaData.push([]); // Empty spacing row

        // Table Column Headers
        const headers = ['Class & Section'];
        schema.slots.forEach(slot => {
            headers.push(slot.slot_type === 'break' ? 'LUNCH BREAK' : `P${slot.slot_order} (${slot.start_time.substring(0, 5)})`);
        });
        headers.push('Room', 'Strength / Capacity');
        aoaData.push(headers);

        const classIdToSections = {};
        sectionsToExport.forEach(s => {
            if (!classIdToSections[s.class_id]) classIdToSections[s.class_id] = [];
            classIdToSections[s.class_id].push(s.id);
        });
        const getSectionDisplayName = (cls) => {
            const siblings = classIdToSections[cls.class_id] || [];
            if (siblings.length <= 1) return `${cls.semester} ${cls.program_name}`;
            const sortedSiblings = [...siblings].sort((a, b) => a - b);
            const idx = sortedSiblings.indexOf(cls.id);
            return `${cls.semester} ${cls.program_name} B${idx + 1}`;
        };

        sectionsToExport.forEach(cls => {
            const className = getSectionDisplayName(cls);

            const row1 = [className];
            schema.slots.forEach(slot => {
                if (slot.slot_type === 'break') {
                    row1.push('Lunch Break');
                } else {
                    const entry = timetable.find(t => t.section_id === cls.id && t.slot_order === slot.slot_order);
                    if (entry) {
                        const onlineTag = Number(entry.is_online) === 1 ? ' [ONLINE]' : '';
                        let cellText = `${entry.subject_code}\n${entry.teacher_name || entry.teacher_short_name || 'N/A'}${onlineTag}`;
                        if (entry.replacement_teacher_name) {
                            cellText += `\n[ENGAGED] ${entry.replacement_teacher_name}`;
                        } else if (entry.is_on_leave) {
                            cellText += `\n[ON LEAVE]`;
                        }
                        row1.push(cellText);
                    } else {
                        row1.push('-');
                    }
                }
            });
            row1.push(cls.room_number || '-');
            row1.push(`${cls.student_strength || '-'} / ${cls.capacity || '-'}`);
            aoaData.push(row1);
        });

        if (aoaData.length <= 4) return toast.warning('No data to export');
        const ws = XLSX.utils.aoa_to_sheet(aoaData);

        // Column Widths
        ws['!cols'] = [{ wch: 32 }]; // Class column width
        for (let i = 0; i < schema.slots.length; i++) ws['!cols'].push({ wch: 22 });
        ws['!cols'].push({ wch: 14 }, { wch: 22 }); // Room, Strength

        // Merge Title & Subtitle Rows
        ws['!merges'] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: schema.slots.length + 2 } },
            { s: { r: 1, c: 2 }, e: { r: 1, c: schema.slots.length + 2 } }
        ];

        // Apply Premium Styling to Cells
        const range = XLSX.utils.decode_range(ws['!ref']);
        for (let R = range.s.r; R <= range.e.r; ++R) {
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
                if (!ws[cellAddress]) continue;

                const cell = ws[cellAddress];
                let style = {
                    font: { name: 'Calibri', sz: 11 },
                    alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
                    border: {
                        top: { style: 'thin', color: { rgb: 'D1D5DB' } },
                        bottom: { style: 'thin', color: { rgb: 'D1D5DB' } },
                        left: { style: 'thin', color: { rgb: 'D1D5DB' } },
                        right: { style: 'thin', color: { rgb: 'D1D5DB' } }
                    }
                };

                // Headings (Row 0)
                if (R === 0) {
                    style.font = { name: 'Calibri', sz: 14, bold: true, color: { rgb: "FFFFFF" } };
                    style.fill = { fgColor: { rgb: "1E3A8A" } }; // Navy blue banner
                    style.border = {};
                    style.alignment.horizontal = 'center';
                }
                // Subtitle (Row 1)
                else if (R === 1) {
                    style.font = { name: 'Calibri', sz: 11, bold: true, color: { rgb: "1E3A8A" } };
                    style.fill = { fgColor: { rgb: "EFF6FF" } };
                    style.border = {};
                    style.alignment.horizontal = 'left';
                }
                // Table Headers (Row 3)
                else if (R === 3) {
                    style.font = { name: 'Calibri', sz: 11, bold: true, color: { rgb: "FFFFFF" } };
                    style.fill = { fgColor: { rgb: "2563EB" } }; // Primary Vivid Blue Header
                }
                // Data Rows (R >= 4)
                else {
                    const val = cell.v ? String(cell.v) : '';

                    if (C === 0) {
                        style.alignment.horizontal = 'left';
                        if (!val.includes('↳')) {
                            style.font.bold = true;
                            style.fill = { fgColor: { rgb: "F3F4F6" } }; // Light gray background for Class column
                        } else {
                            style.font.color = { rgb: "4B5563" };
                            style.font.italic = true;
                        }
                    }

                    if (val === 'Lunch Break' || val === 'LUNCH BREAK') {
                        style.fill = { fgColor: { rgb: "FEF08A" } }; // Gold yellow
                        style.font.color = { rgb: "854D0E" };
                        style.font.bold = true;
                    } else if (val.includes('[ENGAGED]')) {
                        style.fill = { fgColor: { rgb: "D1FAE5" } }; // Light mint green
                        style.font.color = { rgb: "065F46" };
                        style.font.bold = true;
                    } else if (val.includes('[ON LEAVE')) {
                        style.fill = { fgColor: { rgb: "FEE2E2" } }; // Soft red
                        style.font.color = { rgb: "991B1B" };
                        style.font.bold = true;
                    } else if (val.includes('[SCHEDULED]')) {
                        style.font.color = { rgb: "16A34A" }; // Green font
                    } else if (R % 2 !== 0 && !val.includes('↳') && C !== 0) {
                        style.fill = { fgColor: { rgb: "F9FAFB" } };
                    }
                }

                cell.s = style;
            }
        }

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Daily Timetable");
        XLSX.writeFile(wb, `Daily_Timetable_Report_${date}.xlsx`);
        toast.success("Timetable Excel downloaded in proper matrix format");
    };

    const formatCompactClass = (row) => {
        const prog = (row.program_name || '')
            .replace(/\(/g, '')
            .replace(/\)/g, '')
            .replace(/\//g, '')
            .trim();
        const sec = String(row.section_name || '').trim();
        let suffix = '';
        if (sec === 'B' || sec.toLowerCase() === 'section b') suffix = ' B1';
        else if (sec === 'C' || sec.toLowerCase() === 'section c') suffix = ' B2';
        else if (sec === 'D' || sec.toLowerCase() === 'section d') suffix = ' B3';
        else if (sec && sec !== 'A' && sec.toLowerCase() !== 'section a') suffix = ' ' + sec;
        return `${row.semester} ${prog}${suffix}`;
    };

    const columns = [
        {
            header: 'Time',
            accessor: (row) => <div className="fw-medium">{row.start_time.substring(0, 5)} - {row.end_time.substring(0, 5)}</div>
        },
        {
            header: 'Class & Section',
            accessor: (row) => {
                const compactClass = formatCompactClass(row);
                return (
                    <div>
                        <div className="fw-bold text-dark text-nowrap">{compactClass}</div>
                        {(row.department_code || row.department_name) && (
                            <span className="badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25 mt-1 small" style={{ fontSize: '0.72rem' }}>
                                {row.department_code || row.department_name}
                            </span>
                        )}
                    </div>
                );
            }
        },
        {
            header: 'Subject',
            accessor: (row) => (
                <div>
                    <div className="fw-medium text-dark">{row.subject_name}</div>
                    <div className="small text-muted">{row.subject_code} <span className="badge bg-light text-dark border ms-1">{row.subject_type}</span></div>
                </div>
            )
        },
        {
            header: 'Teacher',
            accessor: (row) => row.teacher_name ? (
                <div className="fw-bold text-dark">
                    {row.teacher_name} <span className="small text-dark fw-bold">({row.teacher_short_name})</span>
                </div>
            ) : <span className="text-muted fst-italic">Not Assigned</span>
        },
        {
            header: 'Room',
            accessor: (row) => row.room_number ? (
                <div className="d-flex flex-column align-items-start">
                    <span className="badge bg-light text-dark border fw-bold mb-1">{row.room_number}</span>
                    {row.room_building_name && (row.room_building_id !== row.class_building_id) && (
                        <span className="badge bg-warning text-dark border border-warning shadow-sm mt-1" style={{ fontSize: '0.7rem' }}>
                            <i className="bi bi-building me-1"></i>{row.room_building_name}
                        </span>
                    )}
                </div>
            ) : <span className="text-muted fst-italic">-</span>
        },
        {
            header: 'Status & Engagement',
            accessor: (row) => {
                if (row.replacement_teacher_name) {
                    return (
                        <div className="d-flex align-items-center gap-2">
                            <span className="badge bg-success-light text-success border border-success">Engaged</span>
                            <span className="small fw-medium text-success"><i className="bi bi-person-check me-1"></i>{row.replacement_teacher_name}</span>
                        </div>
                    );
                } else if (row.is_on_leave) {
                    return (
                        <div className="d-flex align-items-center gap-2">
                            <span className="badge bg-danger-light text-danger border border-danger">On Leave</span>
                            <button className="btn btn-sm btn-danger px-3 py-1" onClick={() => handleEngageClick(row)}>Engage Substitute</button>
                        </div>
                    );
                }
                return (
                    <div className="d-flex align-items-center gap-2">
                        <span className="badge bg-light text-secondary border">Scheduled</span>
                        <button className="btn btn-sm btn-outline-primary px-3 py-1" onClick={() => handleEngageClick(row)}>Engage</button>
                    </div>
                );
            }
        }
    ];

    const rowClassName = (row) => {
        if (row.is_on_leave) {
            return row.replacement_teacher_name ? 'table-success' : 'table-danger';
        }
        return '';
    };

    const getFormattedClassRows = () => {
        const classIdToSectionsMap = {};
        departmentSections.forEach(s => {
            if (!classIdToSectionsMap[s.class_id]) classIdToSectionsMap[s.class_id] = [];
            classIdToSectionsMap[s.class_id].push(s.id);
        });
        const getSectionName = (sec) => {
            const siblings = classIdToSectionsMap[sec.class_id] || [];
            if (siblings.length <= 1) return `${sec.semester} ${sec.program_name}`;
            const sorted = [...siblings].sort((a, b) => a - b);
            const idx = sorted.indexOf(sec.id);
            return `${sec.semester} ${sec.program_name} B${idx + 1}`;
        };
        const getShortMergedName = (sectionsArray) => {
            const names = sectionsArray.map(s => getSectionName(s));
            const firstParts = names[0].split(' ');
            let commonPrefixLength = 0;
            for (let i = 0; i < firstParts.length; i++) {
                const prefix = firstParts.slice(0, i + 1).join(' ');
                if (names.every(n => n.startsWith(prefix))) {
                    commonPrefixLength = prefix.length;
                } else {
                    break;
                }
            }
            if (commonPrefixLength > 0) {
                const prefix = names[0].substring(0, commonPrefixLength);
                const suffixes = names.map(n => n.substring(commonPrefixLength).trim());
                return `${prefix} ${suffixes.join(' & ')}`.trim();
            }
            return names.join(' & ');
        };

        const processedGroupIds = new Set();
        const rows = [];
        departmentSections.forEach(sec => {
            if (sec.merge_group_id) {
                if (!processedGroupIds.has(sec.merge_group_id)) {
                    processedGroupIds.add(sec.merge_group_id);
                    const groupSections = departmentSections.filter(s => s.merge_group_id === sec.merge_group_id);
                    const label = getShortMergedName(groupSections);
                    rows.push({
                        id: `merged-${sec.merge_group_id}`,
                        sectionIds: groupSections.map(s => s.id),
                        label: label,
                        isMerged: true,
                        deptName: groupSections[0].department_name || groupSections[0].department_code || 'Unknown Department'
                    });
                }
            } else {
                rows.push({
                    id: `single-${sec.id}`,
                    sectionIds: [sec.id],
                    label: getSectionName(sec),
                    isMerged: false,
                    deptName: sec.department_name || sec.department_code || 'Unknown Department'
                });
            }
        });
        
        const groupedRows = {};
        rows.forEach(row => {
            if (!groupedRows[row.deptName]) groupedRows[row.deptName] = [];
            groupedRows[row.deptName].push(row);
        });
        
        return groupedRows;
    };

    const filteredTeachersForModal = allTeachers;

    return (
        <div className="page-content">
            <PageHeader
                title="Daily Engagements & Timetable"
                subtitle={`Manage daily classes, check faculty leaves, and engage replacements for ${dayName || date}`}
                icon="bi-calendar-day"
                rightContent={
                    <div className="d-flex gap-2 align-items-center">
                        <select className="form-select border-secondary flex-grow-1 flex-sm-grow-0" style={{ width: 'auto' }} value={orientation} onChange={(e) => setOrientation(e.target.value)}>
                            <option value="landscape">Landscape</option>
                            <option value="portrait">Portrait</option>
                        </select>
                        <button className="btn btn-outline-primary flex-grow-1 flex-sm-grow-0" onClick={handlePrint} disabled={timetable.length === 0} title={timetable.length === 0 ? "No Timetable Data" : "Print Timetable"}>
                            <i className="bi bi-printer"></i> <span className="d-none d-md-inline">Print</span>
                        </button>
                        <button className="btn btn-danger flex-grow-1 flex-sm-grow-0" onClick={handleDownloadPDF} disabled={timetable.length === 0} title={timetable.length === 0 ? "No Timetable Data" : "Download PDF"}>
                            <i className="bi bi-file-earmark-pdf"></i> <span className="d-none d-md-inline">PDF</span>
                        </button>
                        <button className="btn btn-success flex-grow-1 flex-sm-grow-0" onClick={exportToExcel} disabled={timetable.length === 0} title={timetable.length === 0 ? "No Timetable Data" : "Download Excel"}>
                            <i className="bi bi-file-earmark-excel"></i> <span className="d-none d-md-inline">Excel</span>
                        </button>
                    </div>
                }
            />

            <div className="card mb-4">
                <div className="card-body">
                    <div className="row g-3 align-items-center">
                        <div className="col-md-3">
                            <label className="form-label">Select Date</label>
                            <input
                                type="date"
                                className="form-control"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                            />
                        </div>
                        <div className="col-md-4">
                            <label className="form-label">Department</label>
                            <select
                                className="form-select"
                                value={selectedDepartment}
                                onChange={(e) => setSelectedDepartment(e.target.value)}
                            >
                                <option value="">All Departments</option>
                                {departments.map(d => (
                                    <option key={d.id} value={d.id}>{d.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="col-md-4 d-flex align-items-end">
                            {dayName && (
                                <div className="ms-auto bg-light border px-4 py-2 rounded-3 text-center">
                                    <span className="d-block small text-muted text-uppercase fw-bold">Day of Week</span>
                                    <span className="fs-5 fw-bold text-primary">{dayName}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Daily Regeneration & Constraints Toolbar */}
            <div className="card mb-4 border-0 shadow-sm bg-light">
                <div className="card-body py-3 d-flex flex-wrap align-items-center justify-content-between gap-3">
                    <div className="d-flex flex-wrap align-items-center gap-2">
                        <button
                            className="btn btn-sm btn-primary d-flex align-items-center gap-2 fw-semibold"
                            onClick={handleRegenerateToday}
                            disabled={loading || !selectedSession || !selectedDepartment}
                            title={!selectedDepartment ? "Please select a specific Department above to enable this action" : "Regenerate today's timetable"}
                        >
                            <i className="bi bi-arrow-repeat"></i> Today only Regenerate time table
                        </button>
                        <button
                            className="btn btn-sm btn-danger d-flex align-items-center gap-2 fw-semibold"
                            onClick={handleClearAllEngagements}
                            disabled={loading || !selectedSession}
                            title="Clear all assigned substitute engagements for this date"
                        >
                            <i className="bi bi-eraser-fill"></i> Clear All Engagements
                        </button>
                        <button
                            className="btn btn-sm btn-outline-danger d-flex align-items-center gap-2"
                            onClick={() => setShowUnavailableModal(true)}
                            disabled={!selectedDepartment}
                            title={!selectedDepartment ? "Please select a specific Department above to enable this action" : "Configure unavailable classes and teachers"}
                        >
                            <i className="bi bi-person-x"></i> Unavailable Classes & Teachers
                            {(unavailableClasses.length + unavailableTeachers.length) > 0 && (
                                <span className="badge bg-danger ms-1">{unavailableClasses.length + unavailableTeachers.length}</span>
                            )}
                        </button>
                        <button
                            className="btn btn-sm btn-outline-dark d-flex align-items-center gap-2"
                            onClick={() => setShowConstraintsModal(true)}
                            disabled={!selectedDepartment}
                            title={!selectedDepartment ? "Please select a specific Department above to enable this action" : "Configure teacher priority and constraints"}
                        >
                            <i className="bi bi-sliders"></i> Teacher Priority & Constraints
                        </button>
                        <button
                            className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-2"
                            onClick={handleOpenHistory}
                            disabled={!selectedDepartment}
                            title={!selectedDepartment ? "Please select a specific Department above to enable this action" : "View regeneration history"}
                        >
                            <i className="bi bi-clock-history"></i> Regeneration History
                        </button>
                    </div>
                    {!selectedDepartment ? (
                        <div className="small text-danger fw-bold d-flex align-items-center gap-1">
                            <i className="bi bi-exclamation-triangle-fill"></i>
                            <span>Please select a Department above to enable Regeneration & Constraint tools</span>
                        </div>
                    ) : (
                        <div className="small text-muted d-none d-lg-block">
                            <i className="bi bi-info-circle me-1"></i>
                            Click slots to cycle: <strong>Available → Preferred → Unavailable → Available</strong>
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                /* Removed sticky positioning to allow class column to scroll naturally */
            `}</style>
            <div className="card">
                {(selectedDepartment || departmentSections.length > 0) ? (
                    // Matrix Grid View
                    <div className="card-body p-0" ref={printRef}>
                        <style>{`
                            @media print {
                                @page { size: ${orientation}; margin: 5mm; }
                                .print-friendly-table {
                                    zoom: ${orientation === 'portrait' ? '0.6' : '0.85'};
                                    overflow: visible !important;
                                    max-height: none !important;
                                    height: auto !important;
                                    width: 100% !important;
                                }
                                thead { display: table-header-group; }
                                tr { page-break-inside: avoid; }
                            }
                        `}</style>
                        {loading ? (
                            <div className="text-center py-5">
                                <div className="spinner-border text-primary"></div>
                                <div className="mt-2 text-muted small">Loading daily grid...</div>
                            </div>
                        ) : departmentSections.length > 0 && schema?.slots ? (
                            <div className="p-0 p-md-3">
                                {(() => {
                                    const classIdToSectionsMap = {};
                                    departmentSections.forEach(s => {
                                        if (!classIdToSectionsMap[s.class_id]) classIdToSectionsMap[s.class_id] = [];
                                        classIdToSectionsMap[s.class_id].push(s.id);
                                    });
                                    const getSectionName = (sec) => {
                                        const siblings = classIdToSectionsMap[sec.class_id] || [];
                                        if (siblings.length <= 1) return `${sec.semester} ${sec.program_name}`;
                                        const sorted = [...siblings].sort((a, b) => a - b);
                                        const idx = sorted.indexOf(sec.id);
                                        return `${sec.semester} ${sec.program_name} B${idx + 1}`;
                                    };
                                    const getShortMergedName = (sectionsArray) => {
                                        const names = sectionsArray.map(s => getSectionName(s));
                                        const firstParts = names[0].split(' ');
                                        let commonPrefixLength = 0;
                                        for (let i = 0; i < firstParts.length; i++) {
                                            const prefix = firstParts.slice(0, i + 1).join(' ');
                                            if (names.every(n => n.startsWith(prefix))) {
                                                commonPrefixLength = prefix.length;
                                            } else {
                                                break;
                                            }
                                        }
                                        if (commonPrefixLength > 0) {
                                            const prefix = names[0].substring(0, commonPrefixLength);
                                            const suffixes = names.map(n => n.substring(commonPrefixLength).trim());
                                            return `${prefix} ${suffixes.join(' & ')}`.trim();
                                        }
                                        return names.join(' & ');
                                    };

                                    const processedGroupIds = new Set();
                                    const rows = [];
                                    departmentSections.forEach(sec => {
                                        if (sec.merge_group_id) {
                                            if (!processedGroupIds.has(sec.merge_group_id)) {
                                                processedGroupIds.add(sec.merge_group_id);
                                                const groupSections = departmentSections.filter(s => s.merge_group_id === sec.merge_group_id);
                                                rows.push({ type: 'merged', groupId: sec.merge_group_id, sections: groupSections });
                                            }
                                        } else {
                                            rows.push({ type: 'single', sections: [sec] });
                                        }
                                    });
                                    const groupedRows = {};
                                    rows.forEach(row => {
                                        const dName = row.sections[0].department_name || row.sections[0].department_code || 'Unknown Department';
                                        if (!groupedRows[dName]) groupedRows[dName] = [];
                                        groupedRows[dName].push(row);
                                    });

                                    return Object.entries(groupedRows).map(([deptName, deptRows], dIndex) => (
                                        <div key={deptName} style={{ pageBreakBefore: dIndex > 0 ? 'always' : 'auto' }} className={dIndex > 0 ? "mt-5" : ""}>
                                            <div className="d-none d-print-flex justify-content-center align-items-center mb-4" style={{ gap: '20px' }}>
                                                <img src={logoImg} alt="AKS Logo" style={{ width: '80px', height: '80px', objectFit: 'contain' }} />
                                                <div className="text-start">
                                                    <h3 className="fw-bold m-0 p-0" style={{ fontSize: '20pt', color: '#1E3A8A' }}>AKS University</h3>
                                                    <h5 className="fw-bold mt-1 mb-1" style={{ fontSize: '14pt' }}>Daily Engagements & Timetable - {deptName}</h5>
                                                    <div className="text-muted" style={{ fontSize: '10pt' }}>Generated on: {generatedDateStr} | Printed on: {new Date().toLocaleString('en-IN')} | Date: {date} ({dayName})</div>
                                                </div>
                                            </div>
                                            
                                            {!selectedDepartment && (
                                                <h5 className="fw-bold text-primary mb-3 d-print-none border-bottom pb-2">{deptName}</h5>
                                            )}

                                            <div className="table-responsive print-friendly-table mb-4" style={{ width: '100%', overflowX: 'auto', overflowY: 'auto', maxHeight: '720px' }}>
                                                <table className="table table-bordered text-center align-middle m-0 daily-timetable-table" style={{ minWidth: '1000px', fontSize: '0.85rem' }} data-dept={deptName}>
                                                    <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                                                        <tr>
                                                            <th className="bg-light text-start sticky-header-md fw-bold text-dark" style={{ width: '180px' }}>Class</th>
                                                            {schema.slots.map(s => (
                                                                <th key={s.id} className="bg-light fw-bold text-dark">
                                                                    <div>{s.slot_type === 'break' ? 'BREAK' : `P${s.slot_order}`}</div>
                                                                    <div className="small fw-bold text-dark">{s.start_time.substring(0, 5)}</div>
                                                                </th>
                                                            ))}
                                                            <th className="bg-light fw-bold text-dark" style={{ width: '100px' }}>Room</th>
                                                            <th className="bg-light fw-bold text-dark" style={{ width: '150px' }}>Strn / Cap</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {deptRows.map(row => {
                                                            const skipSlotIds = new Set();
                                                            const skipEngagedSlotIds = new Set();
                                                            const isMerged = row.type === 'merged';
                                                            const primarySec = row.sections[0];
                                                            const allSectionIds = row.sections.map(s => s.id);

                                                            const rowLabel = isMerged
                                                                ? getShortMergedName(row.sections)
                                                                : getSectionName(primarySec);

                                                            const roomLabel = isMerged
                                                                ? [...new Set(row.sections.map(s => s.room_number || '-'))].join(' / ')
                                                                : (primarySec.room_number || '-');

                                                            const strengthLabel = isMerged
                                                                ? `${row.sections.reduce((sum, s) => sum + (s.student_strength || 0), 0)} / ${Array.from(new Map(row.sections.filter(s => s.room_number).map(s => [s.room_number, s.capacity || 0])).values()).reduce((a, b) => a + b, 0) || '-'}`
                                                                : `${primarySec.student_strength || '-'} / ${primarySec.capacity || '-'}`;

                                                            return (
                                                                <React.Fragment key={isMerged ? `mg${row.groupId}` : primarySec.id}>
                                                                    <tr>
                                                                        <td className="fw-bold bg-light align-middle text-start text-nowrap sticky-col-md" style={{ fontSize: isMerged ? '0.8rem' : '0.85rem' }}>
                                                                            {rowLabel}
                                                                        </td>
                                                                        {schema.slots.map((slot, index) => {
                                                                            if (skipSlotIds.has(slot.id)) return null;

                                                                            if (slot.slot_type === 'break') {
                                                                                return <td key={slot.id} className="bg-light" style={{ width: '100px' }}></td>;
                                                                            }

                                                                            if (!isMerged) {
                                                                                const cls = primarySec;
                                                                                const entry = timetable.find(t => t.section_id === cls.id && t.slot_order === slot.slot_order);
                                                                                if (!entry) return <td key={slot.id} style={{ width: '120px' }}></td>;

                                                                                let colSpan = 1;
                                                                                const isLab = entry.lab_group_id;
                                                                                if (isLab) {
                                                                                    const nextSlot = schema.slots[index + 1];
                                                                                    if (nextSlot && nextSlot.slot_type !== 'break') {
                                                                                        const hasNextSlot = timetable.some(t => t.lab_group_id === entry.lab_group_id && t.section_id === cls.id && t.time_slot_id === nextSlot.id);
                                                                                        if (hasNextSlot) {
                                                                                            colSpan = 2; skipSlotIds.add(nextSlot.id); skipEngagedSlotIds.add(nextSlot.id);
                                                                                        }
                                                                                    }
                                                                                }

                                                                                const baseName = entry.subject_name || entry.subject_code;
                                                                                const shortName = getShortSubjectName(baseName);
                                                                                const isLib = isLibraryEntry(entry);
                                                                                const isRem = isRemedialEntry(entry);
                                                                                const displayName = isLib ? 'Library'
                                                                                    : isRem ? 'REMEDIAL'
                                                                                    : isSelfLearningEntry(typeof e !== "undefined" ? e : (typeof e0 !== "undefined" ? e0 : (typeof entry !== "undefined" ? entry : null))) ? 'Self Learning' : (isLab ? (String(shortName || '').toLowerCase().includes('lab') ? shortName : `${shortName} Lab`) : (entry.subject_code || entry.subject_name || ''));
                                                                                const isEngaged = !!entry.replacement_teacher_name;
                                                                                const origTeacher = isRem ? 'Class Teacher' : (isSelfLearningEntry(typeof e !== 'undefined' ? e : (typeof e0 !== 'undefined' ? e0 : (typeof entry !== 'undefined' ? entry : null))) || isLib) ? '' : (isLab ? (entry.teacher_name || entry.teacher_short_name || 'N/A') : (entry.teacher_short_name || 'N/A'));
                                                                                const subTeacher = entry.replacement_teacher_name || entry.replacement_teacher_short_name || 'N/A';

                                                                                const tags = [];
                                                                                if (!isLib && !isRem && Number(entry.is_online) === 1) tags.push('ONLINE');
                                                                                if (!isLib && !isRem && isNptelSubject(entry)) tags.push('MOOC');
                                                                                const tagStr = tags.length > 0 ? ` {${tags.join(', ')}}` : '';

                                                                                let cellClass = entry.is_on_leave ? 'table-danger' : (isLib ? '' : isRem ? '' : (isSelfLearningEntry(typeof e !== 'undefined' ? e : (typeof e0 !== 'undefined' ? e0 : (typeof entry !== 'undefined' ? entry : null))) ? 'table-success bg-opacity-50' : (isLab ? 'table-success bg-opacity-50' : 'table-primary bg-opacity-10')));
                                                                                const cellStyle = isLib ? { backgroundColor: '#e8f4f8' } : isRem ? { backgroundColor: '#fff3e0' } : isSelfLearningEntry(typeof e !== 'undefined' ? e : (typeof e0 !== 'undefined' ? e0 : (typeof entry !== 'undefined' ? entry : null))) ? { backgroundColor: '#e8f4f8' } : {};
                                                                                if (isEngaged) cellClass = 'bg-warning';

                                                                                return (
                                                                                    <td key={slot.id} colSpan={colSpan} className={`p-0 align-middle ${cellClass}`} style={{ width: `${120 * colSpan}px`, height: '100%', ...cellStyle }}>
                                                                                        <div className="d-flex flex-column justify-content-center align-items-center p-1 w-100 h-100 text-center" style={{ minHeight: '60px' }}>
                                                                                            <div className="fw-bold text-dark text-truncate d-block" style={{ fontSize: '14px', maxWidth: '100%' }} title={entry.subject_name}>
                                                                                                {displayName}
                                                                                                {!isLib && !isRem && entry.room_number && (isLab || entry.room_number !== cls.room_number) && <span className="ms-1" style={{ fontSize: '11px', color: '#666' }}>[{entry.room_number}]</span>}
                                                                                                <span className="text-muted fw-normal ms-1" style={{ fontSize: '11px' }}>{tagStr}</span>
                                                                                            </div>
                                                                                            {!isLib && !isSelfLearningEntry(typeof e !== 'undefined' ? e : (typeof e0 !== 'undefined' ? e0 : (typeof entry !== 'undefined' ? entry : null))) && (isEngaged ? (

                                                                                                <>
                                                                                                    <div className="text-dark fw-bold text-truncate d-block" style={{ fontSize: '13px' }}>
                                                                                                        {subTeacher}
                                                                                                    </div>
                                                                                                    <button 
                                                                                                        className="btn btn-sm btn-outline-danger px-1 py-0 mt-1 d-block w-100 shadow-sm d-print-none" 
                                                                                                        style={{ fontSize: '11px' }}
                                                                                                        onClick={() => handleClearEngage(entry)}
                                                                                                    >
                                                                                                        Clear
                                                                                                    </button>
                                                                                                </>
                                                                                            ) : (
                                                                                                <>
                                                                                                    <div className="text-dark fw-bold text-truncate d-block" style={{ fontSize: '13px' }} title={entry.teacher_name}>{origTeacher}</div>
                                                                                                    <button
                                                                                                        className={`btn btn-sm px-2 py-0 mt-1 d-block w-100 shadow-sm d-print-none ${entry.is_on_leave ? 'btn-danger' : 'btn-outline-primary'}`}
                                                                                                        style={{ fontSize: '13px' }}
                                                                                                        onClick={() => handleEngageClick(entry)}
                                                                                                    >
                                                                                                        Engage
                                                                                                    </button>
                                                                                                </>
                                                                                            ))}
                                                                                        </div>
                                                                                    </td>
                                                                                );
                                                                            } else {
                                                                                // MERGED LOGIC
                                                                                const entries = row.sections.map(s => timetable.find(t => t.section_id === s.id && t.slot_order === slot.slot_order)).filter(e => e);
                                                                                if (entries.length === 0) return <td key={slot.id} style={{ width: '120px' }}></td>;

                                                                                let colSpan = 1;
                                                                                const subjectMap = new Map();
                                                                                entries.forEach(e => {
                                                                                    const key = `${e.subject_code || e.subject_name}-${e.teacher_id}-${e.is_online}-${e.replacement_teacher_id || 'none'}`;
                                                                                    if (!subjectMap.has(key)) subjectMap.set(key, []);
                                                                                    subjectMap.get(key).push(e);
                                                                                    
                                                                                    if (e.lab_group_id && colSpan === 1) {
                                                                                        const nextSlot = schema.slots[index + 1];
                                                                                        if (nextSlot && nextSlot.slot_type !== 'break') {
                                                                                            const hasNextSlot = timetable.some(t => t.lab_group_id === e.lab_group_id && t.time_slot_id === nextSlot.id);
                                                                                            if (hasNextSlot) {
                                                                                                colSpan = 2; skipSlotIds.add(nextSlot.id); skipEngagedSlotIds.add(nextSlot.id);
                                                                                            }
                                                                                        }
                                                                                    }
                                                                                });

                                                                                const cards = Array.from(subjectMap.values()).map((grp, i) => {
                                                                                    const e0 = grp[0];
                                                                                    const isLib = isLibraryEntry(e0);
                                                                                    const isRem = isRemedialEntry(e0);
                                                                                    const isLab = !isLib && !isRem && (e0.subject_type === 'lab' || (e0.subject_type === 'both' && e0.lab_group_id));
                                                                                    const baseName = e0.subject_name || e0.subject_code;
                                                                                    const shortName = getShortSubjectName(baseName);
                                                                                    const displayName = isLib ? 'Library' : isRem ? 'REMEDIAL' : isSelfLearningEntry(typeof e !== 'undefined' ? e : (typeof e0 !== 'undefined' ? e0 : (typeof entry !== 'undefined' ? entry : null))) ? 'Self Learning' : (isLab ? (String(shortName || '').toLowerCase().includes('lab') ? shortName : `${shortName} Lab`) : (e0.subject_code || e0.subject_name || ''));
                                                                                    const isEngaged = !!e0.replacement_teacher_name;
                                                                                    const origTeacher = isRem ? 'Class Teacher' : (isSelfLearningEntry(typeof e !== 'undefined' ? e : (typeof e0 !== 'undefined' ? e0 : (typeof entry !== 'undefined' ? entry : null))) || isLib) ? '' : (isLab ? (e0.teacher_name || e0.teacher_short_name || 'N/A') : (e0.teacher_short_name || 'N/A'));
                                                                                    const subTeacher = e0.replacement_teacher_name || e0.replacement_teacher_short_name || 'N/A';
                                                                                    
                                                                                    const tags = [];
                                                                                    if (Number(e0.is_online) === 1) tags.push('ONL');
                                                                                    if (isNptelSubject(e0)) tags.push('MOOC');
                                                                                    if (grp.length < row.sections.length && !isLab) {
                                                                                        const bNames = grp.map(g => {
                                                                                            const sec = row.sections.find(s => s.id === g.section_id);
                                                                                            const secName = getSectionName(sec);
                                                                                            const match = secName.match(/B(\d+)/);
                                                                                            if (match) return `B${match[1]}`;
                                                                                            const parenMatch = secName.match(/\(([^)]+)\)/g);
                                                                                            if (parenMatch && parenMatch.length > 0) {
                                                                                                const last = parenMatch[parenMatch.length - 1];
                                                                                                return last.replace(/[()]/g, '');
                                                                                            }
                                                                                            return secName.split(' ').pop();
                                                                                        });
                                                                                        tags.push([...new Set(bNames)].join(','));
                                                                                    }
                                                                                    const tagStr = tags.length > 0 ? ` {${tags.join(', ')}}` : '';

                                                                                    return (
                                                                                        <div key={i} className={`d-flex flex-column justify-content-center align-items-center p-1 w-100 ${i > 0 ? 'border-top border-dark border-opacity-25' : ''}`} style={{ minHeight: '60px' }}>
                                                                                            <div className="fw-bold text-dark text-truncate d-block" style={{ fontSize: '14px', maxWidth: '100%' }} title={e0.subject_name}>
                                                                                                {displayName}
                                                                                                <span className="text-muted fw-normal" style={{ fontSize: '11px' }}>{tagStr}</span>
                                                                                            </div>
                                                                                            {isEngaged ? (
                                                                                                <>
                                                                                                    <div className="text-dark fw-bold text-truncate d-block" style={{ fontSize: '13px' }}>
                                                                                                        {subTeacher}
                                                                                                    </div>
                                                                                                    <button 
                                                                                                        className="btn btn-sm btn-outline-danger px-1 py-0 mt-1 d-block w-100 shadow-sm d-print-none" 
                                                                                                        style={{ fontSize: '11px' }}
                                                                                                        onClick={() => handleClearEngage(e0)}
                                                                                                    >
                                                                                                        Clear
                                                                                                    </button>
                                                                                                </>
                                                                                            ) : (
                                                                                                <>
                                                                                                    <div className="text-dark fw-bold text-truncate d-block" style={{ fontSize: '13px' }} title={e0.teacher_name}>{origTeacher}</div>
                                                                                                    <button
                                                                                                        className={`btn btn-sm px-2 py-0 mt-1 d-block w-100 shadow-sm d-print-none ${e0.is_on_leave ? 'btn-danger' : 'btn-outline-primary'}`}
                                                                                                        style={{ fontSize: '13px' }}
                                                                                                        onClick={() => handleEngageClick(e0)}
                                                                                                    >
                                                                                                        Engage
                                                                                                    </button>
                                                                                                </>
                                                                                            )}
                                                                                        </div>
                                                                                    );
                                                                                });

                                                                                const firstCardEntry = Array.from(subjectMap.values())[0]?.[0];
                                                                                const isLabFirst = firstCardEntry && (firstCardEntry.subject_type === 'lab' || (firstCardEntry.subject_type === 'both' && firstCardEntry.lab_group_id));
                                                                                const hasOnLeaveFirst = firstCardEntry && firstCardEntry.is_on_leave;
                                                                                const isEngagedFirst = firstCardEntry && firstCardEntry.replacement_teacher_name;

                                                                                let tdBgClass = '';
                                                                                if (isEngagedFirst) {
                                                                                    tdBgClass = 'bg-warning';
                                                                                } else if (firstCardEntry) {
                                                                                    tdBgClass = hasOnLeaveFirst ? 'bg-danger bg-opacity-25' : (isLabFirst ? 'bg-success bg-opacity-50' : 'table-primary bg-opacity-10');
                                                                                }

                                                                                return (
                                                                                    <td key={slot.id} colSpan={colSpan} className={`p-0 align-middle ${tdBgClass}`} style={{ width: `${120 * colSpan}px`, height: '100%' }}>
                                                                                        {cards}
                                                                                    </td>
                                                                                );
                                                                            }
                                                                        })}
                                                                        <td className="align-middle bg-light fw-medium" style={{ fontSize: '0.8rem' }}>{roomLabel}</td>
                                                                        <td className="align-middle bg-light text-muted small" style={{ fontSize: '0.8rem' }}>{strengthLabel}</td>
                                                                    </tr>
                                                                </React.Fragment>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    ));
                                })()}
                            </div>
                        ) : (
                            <div className="text-center py-5 text-muted">
                                <i className="bi bi-calendar-x fs-1 d-block mb-3"></i>
                                {departmentSections.length === 0 ? "No classes found for this department." : "No time slots configured."}
                            </div>
                        )}
                    </div>
                ) : (
                    // List View
                    <DataTable
                        columns={columns}
                        data={timetable.slice((currentPage - 1) * 20, currentPage * 20)}
                        loading={loading}
                        hidePagination={false}
                        page={currentPage}
                        totalPages={Math.ceil(timetable.length / 20) || 1}
                        totalRows={timetable.length}
                        setPage={setCurrentPage}
                        emptyMessage={`No classes scheduled for ${dayName || 'this date'}. Select a department to view the complete grid.`}
                        emptyIcon="bi-calendar-x"
                        renderRow={(row, idx) => (
                            <tr key={idx} className={rowClassName(row)}>
                                {columns.map((col, colIdx) => (
                                    <td key={colIdx} className={col.cellClassName || ''}>
                                        {col.render
                                            ? col.render(typeof col.accessor === 'function' ? col.accessor(row) : row[col.accessor], row)
                                            : typeof col.accessor === 'function'
                                                ? col.accessor(row)
                                                : row[col.accessor]
                                        }
                                    </td>
                                ))}
                            </tr>
                        )}
                    />
                )}
            </div>

            {/* Engage Modal */}
            {showEngageModal && engageData && (
                <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content border-0 shadow-lg">
                            <div className="modal-header border-bottom-0 pb-0">
                                <h5 className="modal-title fw-bold">Engage Replacement Teacher</h5>
                                <button type="button" className="btn-close" onClick={() => setShowEngageModal(false)}></button>
                            </div>
                            <div className="modal-body py-4">
                                <div className="alert alert-danger border-0">
                                    <div className="fw-bold mb-1">Teacher on Leave: {engageData.teacher_name}</div>
                                    <div className="small">Class: {engageData.program_name} Sem {engageData.semester} - {engageData.section_name}</div>
                                    <div className="small">Subject: {engageData.subject_name} ({engageData.subject_type})</div>
                                    <div className="small">Time: {engageData.start_time} - {engageData.end_time}</div>
                                </div>

                                <div className="mb-3 mt-4">
                                    <label className="form-label fw-medium">Available Substitute Teachers</label>
                                    {loadingSubs ? (
                                        <div className="text-center py-3 text-muted">
                                            <div className="spinner-border spinner-border-sm me-2"></div> Finding available teachers...
                                        </div>
                                    ) : substitutes.length === 0 ? (
                                        <div className="alert alert-warning border-0 small">
                                            No free teachers found for this timeslot.
                                        </div>
                                    ) : (
                                        <select
                                            className="form-select form-select-lg"
                                            value={selectedSub}
                                            onChange={(e) => setSelectedSub(e.target.value)}
                                        >
                                            <option value="">-- Select Substitute --</option>
                                            {substitutes.filter(sub => !/class\s*teacher/i.test(sub.full_name || '') && !/class\s*teacher/i.test(sub.short_name || '') && !/class\s*teacher/i.test(sub.designation || '')).map(sub => {
                                                const isLabTeacher = sub.designation && (sub.designation.toLowerCase().includes('lab') || sub.designation.toLowerCase().includes('instructor'));
                                                return (
                                                    <option key={sub.id} value={sub.id} className={isLabTeacher ? 'text-success fw-bold' : 'text-primary fw-bold'}>
                                                        {sub.full_name} ({sub.short_name}) - Current Load: {sub.current_workload} classes {isLabTeacher ? '(Lab)' : '(Theory)'}
                                                    </option>
                                                );
                                            })}
                                        </select>
                                    )}
                                </div>
                            </div>
                            <div className="modal-footer border-top-0 bg-light rounded-bottom">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowEngageModal(false)}>Cancel</button>
                                <button
                                    type="button"
                                    className="btn btn-primary px-4"
                                    onClick={handleAssignSubstitute}
                                    disabled={!selectedSub || assigning}
                                >
                                    {assigning ? <><span className="spinner-border spinner-border-sm me-2"></span>Assigning...</> : 'Confirm Engagement'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Constraints Modal */}
            <TeacherConstraintsModal
                show={showConstraintsModal}
                onHide={() => setShowConstraintsModal(false)}
                selectedDepartment={selectedDepartment}
            />

            {/* Unavailable Classes & Teachers Modal */}
            {showUnavailableModal && (
                <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-dialog-centered modal-lg">
                        <div className="modal-content border-0 shadow-lg">
                            <div className="modal-header border-bottom">
                                <h5 className="modal-title fw-bold">Unavailable Classes & Teachers (Today Only)</h5>
                                <button type="button" className="btn-close" onClick={() => setShowUnavailableModal(false)}></button>
                            </div>
                            <div className="modal-body py-4">
                                <p className="small text-muted mb-3">
                                    Select any classes or teachers that are unavailable today due to programs, events, or absence. They will be excluded from today's timetable regeneration.
                                </p>
                                <div className="row g-4">
                                    <div className="col-md-6">
                                        <label className="form-label fw-bold small text-uppercase">Unavailable Classes / Sections</label>
                                        <div className="border rounded p-2" style={{ maxHeight: '240px', overflowY: 'auto' }}>
                                            {Object.entries(getFormattedClassRows()).map(([deptName, rows]) => (
                                                <div key={deptName}>
                                                    <div className="text-muted small fw-bold mb-1 mt-2">{deptName}</div>
                                                    {rows.map(row => {
                                                        const isChecked = row.sectionIds.every(id => unavailableClasses.includes(id));
                                                        return (
                                                            <div key={row.id} className="form-check small mb-2">
                                                                <input
                                                                    type="checkbox"
                                                                    className="form-check-input"
                                                                    id={`unav-sec-${row.id}`}
                                                                    checked={isChecked}
                                                                    onChange={(e) => {
                                                                        if (e.target.checked) {
                                                                            const newSet = new Set([...unavailableClasses, ...row.sectionIds]);
                                                                            setUnavailableClasses(Array.from(newSet));
                                                                        } else {
                                                                            setUnavailableClasses(unavailableClasses.filter(id => !row.sectionIds.includes(id)));
                                                                        }
                                                                    }}
                                                                />
                                                                <label className="form-check-label fw-medium" htmlFor={`unav-sec-${row.id}`}>
                                                                    {row.label}
                                                                    {row.isMerged && <span className="badge bg-info-subtle text-info-emphasis border ms-2">Merged</span>}
                                                                </label>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="col-md-6">
                                        <label className="form-label fw-bold small text-uppercase">Unavailable Teachers ({filteredTeachersForModal.length})</label>
                                        <div className="border rounded p-2" style={{ maxHeight: '240px', overflowY: 'auto' }}>
                                            {filteredTeachersForModal.length === 0 ? (
                                                <div className="text-muted small py-2">No faculty found in this department.</div>
                                            ) : (
                                                filteredTeachersForModal.map(tch => (
                                                    <div key={tch.id} className="form-check small mb-1">
                                                        <input
                                                            type="checkbox"
                                                            className="form-check-input"
                                                            id={`unav-tch-${tch.id}`}
                                                            checked={unavailableTeachers.includes(tch.id)}
                                                            onChange={(e) => {
                                                                if (e.target.checked) {
                                                                    setUnavailableTeachers([...unavailableTeachers, tch.id]);
                                                                } else {
                                                                    setUnavailableTeachers(unavailableTeachers.filter(id => id !== tch.id));
                                                                }
                                                            }}
                                                        />
                                                        <label className="form-check-label" htmlFor={`unav-tch-${tch.id}`}>
                                                            {tch.full_name} ({tch.short_name})
                                                        </label>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="modal-footer bg-light">
                                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => { setUnavailableClasses([]); setUnavailableTeachers([]); }}>Clear All</button>
                                <button type="button" className="btn btn-primary btn-sm px-4" onClick={() => setShowUnavailableModal(false)}>Save Exclusions</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Regeneration History Modal */}
            {showHistoryModal && (
                <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-dialog-centered modal-lg">
                        <div className="modal-content border-0 shadow-lg">
                            <div className="modal-header border-bottom">
                                <h5 className="modal-title fw-bold">Daily Timetable Regeneration History</h5>
                                <button type="button" className="btn-close" onClick={() => setShowHistoryModal(false)}></button>
                            </div>
                            <div className="modal-body py-3" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                                {historyList.length === 0 ? (
                                    <div className="text-center py-4 text-muted">No daily regenerations recorded yet.</div>
                                ) : (
                                    <table className="table table-bordered table-sm small align-middle">
                                        <thead className="table-light">
                                            <tr>
                                                <th>Date Regenerated</th>
                                                <th>Target Day</th>
                                                <th>Generated By</th>
                                                <th>Timestamp</th>
                                                <th>Exclusions / Notes</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {historyList.map(item => {
                                                let meta = {};
                                                try { meta = typeof item.new_value === 'string' ? JSON.parse(item.new_value) : item.new_value; } catch (e) {
                                                    console.error('Error parsing meta:', e);
                                                }
                                                return (
                                                    <tr key={item.id}>
                                                        <td className="fw-bold">{meta.date || '-'}</td>
                                                        <td><span className="badge bg-light text-dark border">{meta.dayName || '-'}</span></td>
                                                        <td>{item.generated_by_name || 'System'}</td>
                                                        <td>{new Date(item.created_at).toLocaleString()}</td>
                                                        <td>
                                                            {(meta.unavailable_classes?.length || 0) + (meta.unavailable_teachers?.length || 0) > 0 ? (
                                                                <span className="text-danger">Excl: {meta.unavailable_classes?.length || 0} classes, {meta.unavailable_teachers?.length || 0} teachers</span>
                                                            ) : 'No exclusions'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                            <div className="modal-footer bg-light">
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowHistoryModal(false)}>Close</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DailyTimetable;
