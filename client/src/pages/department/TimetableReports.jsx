import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../utils/api';
import PageHeader from '../../components/common/PageHeader';
import { useReactToPrint } from 'react-to-print';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import XLSX from 'xlsx-js-style';
import { useLocation } from 'react-router-dom';
import logoImg from '../../assets/logo.png';
import Swal from 'sweetalert2';


const renderRoomBadge = (rStr) => {
    if (!rStr) return null;
    if (rStr.includes(' - ')) {
        const parts = rStr.split(' - ');
        const room = parts[0];
        const block = parts[1];
        return (
            <span className="d-inline-flex align-items-center">
                [{room}]
                <span className="badge bg-warning text-dark border border-warning ms-1 px-1 py-0 shadow-sm" style={{ fontSize: '0.65rem', lineHeight: '1.2' }}>{block}</span>
            </span>
        );
    }
    return <span>[{rStr}]</span>;
};

const formatRoomName = (entry) => {
    if (!entry || !entry.room_number) return null;
    if (entry.room_building_id && entry.class_building_id && entry.room_building_id !== entry.class_building_id) {
        return `${entry.room_number} - ${entry.room_building_name || 'Other Block'}`;
    }
    return entry.room_number;
};


const getSubjectColor = (subjectStr) => {
    if (!subjectStr) return { bg: 'var(--bs-primary-bg-subtle)', border: 'var(--bs-primary-border-subtle)', text: 'var(--bs-primary-text-emphasis)' };
    let hash = 0;
    for (let i = 0; i < subjectStr.length; i++) {
        hash = subjectStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return {
        bg: `hsl(${hue}, 85%, 95%)`,
        border: `hsl(${hue}, 80%, 85%)`,
        text: `hsl(${hue}, 85%, 25%)`
    };
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
    // Only exact matches: subject_code must be exactly 'LIB' or subject_name exactly 'library period'
    // Do NOT use substring matching on name as it would match 'Library and information services' (LIS)
    return code === 'LIB' || name === 'library period' || name === 'library';
};



const TimetableReports = () => {
    const { user } = useAuth();
    const isDeptAdmin = user?.role === 'DEPARTMENT_ADMIN';
    const location = useLocation();
    const [sessions, setSessions] = useState([]);
    const [departments, setDepartments] = useState([]);

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

    const [selectedSession, setSelectedSession] = useState('');
    const [reportType, setReportType] = useState('department'); // department, all_classes, teacher, all_teachers, room, all_rooms
    const [selectedFilterDept, setSelectedFilterDept] = useState(isDeptAdmin ? user.department_id : ''); // filter for class, teacher, room
    const [selectedTarget, setSelectedTarget] = useState(isDeptAdmin ? user.department_id : ''); // department_id, teacher_id, or room_id
    const [orientation, setOrientation] = useState('landscape');
    const orientationRef = useRef(orientation);
    useEffect(() => { orientationRef.current = orientation; }, [orientation]);

    const [departmentSections, setDepartmentSections] = useState([]);

    const [targets, setTargets] = useState([]); // List of teachers/rooms/departments based on type

    const [timetable, setTimetable] = useState([]);
    const [loading, setLoading] = useState(false);

    const [schema, setSchema] = useState({ days: [], slots: [] });
    const [logoBase64, setLogoBase64] = useState(null);

    const printRef = useRef();

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

    useEffect(() => {
        const fetchInitial = async () => {
            try {
                const [sessRes, deptRes, schemaRes] = await Promise.all([
                    api.get('/sessions?limit=100'),
                    api.get('/departments?limit=100'),
                    api.get('/timetable/schema')
                ]);
                const queryParams = new URLSearchParams(location.search);
                const urlSession = queryParams.get('session_id');
                const urlDept = queryParams.get('department_id');

                if (sessRes.data.success) {
                    setSessions(sessRes.data.data);
                    if (urlSession) {
                        setSelectedSession(urlSession);
                    } else {
                        const active = sessRes.data.data.find(s => s.is_active);
                        if (active) setSelectedSession(active.id.toString());
                    }
                }
                if (deptRes.data.success) {
                    setDepartments(deptRes.data.data);
                    if (isDeptAdmin) {
                        setReportType('department');
                        setSelectedTarget(user.department_id);
                    } else if (urlDept) {
                        setReportType('department');
                        setSelectedTarget(urlDept);
                    }
                }
                if (schemaRes.data.success) setSchema(schemaRes.data.data);
            } catch (error) {
                console.error("Failed to fetch initial data for reports");
            }
        };
        fetchInitial();
    }, []);

    useEffect(() => {
        const loadTargets = async () => {
            setTargets([]);
            setSelectedTarget('');
            setTimetable([]);
            if (reportType === 'department' || reportType === 'all_classes' || reportType === 'all_labs') {
                setTargets(departments);
            } else if (reportType === 'class') {
                let url = selectedSession ? `/classes/all-sections?session_id=${selectedSession}` : `/classes/all-sections`;
                if (selectedFilterDept) {
                    url += (url.includes('?') ? '&' : '?') + `department_id=${selectedFilterDept}`;
                }
                const res = await api.get(url);
                if (res.data.success) setTargets(res.data.data);
            } else if (reportType === 'teacher') {
                let url = '/teachers?limit=1000';
                if (selectedFilterDept) url += `&department_id=${selectedFilterDept}`;
                const res = await api.get(url);
                if (res.data.success) setTargets(res.data.data);
            } else if (reportType === 'room') {
                let url = '/rooms?limit=1000';
                if (selectedFilterDept) url += `&department=${selectedFilterDept}`;
                const res = await api.get(url);
                if (res.data.success) setTargets(res.data.data);
            }
        };
        loadTargets();
    }, [reportType, departments, selectedSession, selectedFilterDept]);

    useEffect(() => {
        const fetchTimetable = async () => {
            if (!selectedSession || (!selectedTarget && !['all_teachers', 'all_rooms', 'all_departments'].includes(reportType))) {
                setTimetable([]);
                return;
            }
            setLoading(true);
            try {
                let url = `/timetable?session_id=${selectedSession}`;
                if (reportType === 'department' || reportType === 'all_classes' || reportType === 'all_labs') url += `&department_id=${selectedTarget}`;
                else if (reportType === 'class') url += `&section_id=${selectedTarget}`;
                else if (reportType === 'teacher') url += `&teacher_id=${selectedTarget}`;
                else if (reportType === 'room') url += `&room_id=${selectedTarget}`;
                else if (reportType === 'all_teachers' || reportType === 'all_rooms') {
                    if (selectedFilterDept) url += `&department_id=${selectedFilterDept}`;
                }

                const res = await api.get(url);
                if (res.data.success) {
                    setTimetable(res.data.data);
                }

                if (reportType === 'department') {
                    const secRes = await api.get(`/classes/all-sections?department_id=${selectedTarget}&session_id=${selectedSession}`);
                    if (secRes.data.success) {
                        setDepartmentSections(secRes.data.data);
                    }
                } else if (reportType === 'all_departments') {
                    const secRes = await api.get(`/classes/all-sections?session_id=${selectedSession}`);
                    if (secRes.data.success) {
                        setDepartmentSections(secRes.data.data);
                    }
                } else {
                    setDepartmentSections([]);
                }
            } catch (error) {
                console.error("Failed to load report timetable");
            } finally {
                setLoading(false);
            }
        };
        fetchTimetable();
    }, [selectedSession, reportType, selectedTarget]);

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: `Timetable_Report_${reportType}`,
        pageStyle: () => `@page { size: ${orientationRef.current}; margin: 5mm; }`,
    });

    const handleDownloadPDF = () => {
        const doc = new jsPDF(orientation, 'mm', 'a3');
        const tables = document.querySelectorAll('.report-table');

        groupedTimetables.forEach((group, idx) => {
            if (idx > 0) doc.addPage();

            const printDate = new Date().toLocaleString('en-IN');

            let startX = 14;
            if (logoBase64) {
                doc.addImage(logoBase64, 'PNG', 14, 8, 16, 16);
                startX = 34;
            }

            doc.setFontSize(18);
            doc.setTextColor(30, 58, 138);
            doc.text("AKS University", startX, 15);

            doc.setTextColor(0, 0, 0);
            doc.setFontSize(14);
            doc.text(group.title, startX, 22);

            doc.setFontSize(10);
            doc.setTextColor(100, 100, 100);
            doc.text(`Generated on: ${generatedDateStr} | Printed on: ${printDate}`, startX, 27);

            autoTable(doc, {
                html: tables[idx],
                startY: 32,
                theme: 'grid',
                useCss: true,
                styles: { fontSize: 8, cellPadding: 2, halign: 'center', valign: 'middle' },
                headStyles: { fillColor: [30, 58, 138], textColor: [255, 255, 255], fontStyle: 'bold' },
                didParseCell: function (data) {
                    if (data.section === 'body') {
                        const cellText = data.cell.text ? data.cell.text.join('').toUpperCase() : '';
                        if (cellText.includes('LUNCH') || cellText === 'BREAK') {
                            data.cell.styles.fillColor = [254, 240, 138];
                            data.cell.styles.textColor = [133, 77, 14];
                            data.cell.styles.fontStyle = 'bold';
                        }
                    }
                }
            });
        });

        doc.save(`Timetable_Report_${reportType}.pdf`);
    };

    const handleExportExcel = async () => {
        if (groupedTimetables.length > 1) {
            const result = await Swal.fire({
                title: 'Export Multiple Files?',
                text: `This will generate and download ${groupedTimetables.length} separate Excel files. Do you want to proceed?`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes, download all',
                cancelButtonText: 'Cancel'
            });
            if (!result.isConfirmed) return;
        }

        const tables = document.querySelectorAll('.report-table');
        const dateStr = new Date().toLocaleDateString('en-GB');
        const timeStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

        groupedTimetables.forEach((group, idx) => {
            const wb = XLSX.utils.book_new();
            const table = tables[idx];
            if (!table) return;
            let rawName = group.title.replace(/^Department of\s+/i, '').replace(/\s*Master Timetable$/i, '');
            let sheetName = rawName.substring(0, 31).replace(/[\\/*?:\[\]]/g, '').trim() || `Sheet_1`;

            // Create initial worksheet with title and subtitle rows
            const ws = XLSX.utils.aoa_to_sheet([
                ["AKS University"],
                [group.title],
                [`Report Type: ${reportType.toUpperCase()} | Generated on: ${generatedDateStr} | Printed on: ${dateStr}, ${timeStr}`],
                [] // Empty spacer row
            ]);

            // Add HTML table DOM at A5 (5th row, 0-indexed r: 4)
            XLSX.utils.sheet_add_dom(ws, table, { origin: "A5" });

            const range = XLSX.utils.decode_range(ws['!ref']);

            // Ensure merges array exists and merge Title & Subtitle across all table columns
            if (!ws['!merges']) ws['!merges'] = [];
            ws['!merges'].push(
                { s: { r: 0, c: 0 }, e: { r: 0, c: range.e.c } },
                { s: { r: 1, c: 0 }, e: { r: 1, c: range.e.c } },
                { s: { r: 2, c: 0 }, e: { r: 2, c: range.e.c } }
            );

            // Apply Styles across all rows and columns
            for (let R = range.s.r; R <= range.e.r; ++R) {
                for (let C = range.s.c; C <= range.e.c; ++C) {
                    const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
                    if (!ws[cellAddress]) {
                        ws[cellAddress] = { t: 's', v: '' };
                    }

                    const cell = ws[cellAddress];
                    const val = cell.v ? String(cell.v).trim() : '';

                    if (R === 0) {
                        cell.s = {
                            font: { name: 'Calibri', sz: 18, bold: true, color: { rgb: "1E3A8A" } },
                            fill: { fgColor: { rgb: "EFF6FF" } },
                            alignment: { vertical: 'center', horizontal: 'center' }
                        };
                    }
                    // Row 1: Title Banner
                    else if (R === 1) {
                        cell.s = {
                            font: { name: 'Calibri', sz: 16, bold: true, color: { rgb: "FFFFFF" } },
                            fill: { fgColor: { rgb: "1E3A8A" } },
                            alignment: { vertical: 'center', horizontal: 'center' }
                        };
                    }
                    // Row 2: Subtitle Ribbon
                    else if (R === 2) {
                        cell.s = {
                            font: { name: 'Calibri', sz: 12, bold: true, color: { rgb: "1E3A8A" } },
                            fill: { fgColor: { rgb: "EFF6FF" } },
                            alignment: { vertical: 'center', horizontal: 'center' }
                        };
                    }
                    // Row 3: Spacer
                    else if (R === 3) {
                        cell.s = {
                            fill: { fgColor: { rgb: "FFFFFF" } }
                        };
                    }
                    // Row 4: Table Headers (DAY, CLASS, P1, P2...)
                    else if (R === 4) {
                        cell.s = {
                            font: { name: 'Calibri', sz: 13, bold: true, color: { rgb: "FFFFFF" } },
                            fill: { fgColor: { rgb: "1E3A8A" } },
                            alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
                            border: {
                                top: { style: 'medium', color: { rgb: '1E3A8A' } },
                                bottom: { style: 'medium', color: { rgb: '1E3A8A' } },
                                left: { style: 'thin', color: { rgb: '1E3A8A' } },
                                right: { style: 'thin', color: { rgb: '1E3A8A' } }
                            }
                        };
                    }
                    // Data Rows (R > 3)
                    else {
                        let style = {
                            font: { name: 'Calibri', sz: 12 },
                            alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
                            border: {
                                top: { style: 'thin', color: { rgb: 'E5E7EB' } },
                                bottom: { style: 'thin', color: { rgb: 'E5E7EB' } },
                                left: { style: 'thin', color: { rgb: 'E5E7EB' } },
                                right: { style: 'thin', color: { rgb: 'E5E7EB' } }
                            }
                        };

                        // First column (Day/Class name)
                        if (C === 0 || (group.isMasterGrid && C === 1)) {
                            style.font.bold = true;
                            style.font.color = { rgb: "1E3A8A" };
                            style.fill = { fgColor: { rgb: "F8FAFC" } };
                            if (C === 0 && group.isMasterGrid && val.length > 2 && val !== 'DAY') {
                                style.alignment.textRotation = 90; // Vertical text
                            }
                        }
                        // Break / Lunch
                        else if (val.toUpperCase().includes('LUNCH') || val.toUpperCase() === 'BREAK') {
                            style.fill = { fgColor: { rgb: "FEF08A" } };
                            style.font.bold = true;
                            style.font.color = { rgb: "92400E" };
                        }
                        // Lab (detect bracket indicating room for labs or LAB keyword)
                        else if ((val.includes('[') && val.includes(']')) || val.toUpperCase().includes('LAB')) {
                            style.fill = { fgColor: { rgb: "DCFCE7" } }; // Mint green for Lab
                            style.font.bold = true;
                            style.font.color = { rgb: "146C43" };
                        }
                        // Theory (standard subject entry)
                        else if (val !== '' && val !== '-' && val !== 'DAY' && val !== 'CLASS') {
                            style.fill = { fgColor: { rgb: "F0FDF4" } }; // Light green for Theory
                            style.font.color = { rgb: "166534" };
                        }
                        // Empty cells
                        else {
                            style.fill = { fgColor: { rgb: "FFFFFF" } };
                        }

                        cell.s = style;
                    }
                }
            }

            // Set row heights
            ws['!rows'] = [
                { hpt: 38 }, // Title Banner
                { hpt: 26 }, // Subtitle Ribbon
                { hpt: 10 }, // Spacer
                { hpt: 28 }  // Header Row
            ];
            for (let r = 4; r <= range.e.r; r++) {
                ws['!rows'].push({ hpt: 45 });
            }

            // Set optimal column widths
            ws['!cols'] = [{ wch: 16 }];
            if (group.isMasterGrid) ws['!cols'].push({ wch: 28 });
            for (let i = 0; i < schema.slots.length; i++) {
                ws['!cols'].push({ wch: 24 });
            }

            XLSX.utils.book_append_sheet(wb, ws, sheetName);

            let fileName = group.title.replace(/[\\/*?:\[\]]/g, '').trim();
            XLSX.writeFile(wb, `${fileName}.xlsx`);
        });
    };

    const groupedTimetables = useMemo(() => {
        const visibleTimetable = timetable.filter(t => t.is_hidden !== 1 && t.is_hidden !== true);
        if (!visibleTimetable.length) return [];

        if (reportType === 'teacher' || reportType === 'room') {
            const title = reportType === 'teacher'
                ? `Teacher: ${targets.find(t => t.id.toString() === selectedTarget)?.full_name || ''}`
                : `Room: ${targets.find(t => t.id.toString() === selectedTarget)?.room_number || ''}`;
            return [{ title, entries: visibleTimetable }];
        }

        if (reportType === 'class') {
            const sec = targets.find(t => t.id.toString() === selectedTarget);
            const title = sec ? `Class: ${sec.semester} ${sec.program_name} ${sec.section_name || ''}` : 'Class Timetable';
            return [{ title, entries: visibleTimetable }];
        }

        if (reportType === 'department') {
            const departmentName = targets.find(t => t.id.toString() === selectedTarget)?.name || 'Department';
            // Build class_id -> sorted section ids map for B1/B2/B3 naming
            const classIdToSections = {};
            departmentSections.forEach(sec => {
                if (!classIdToSections[sec.class_id]) classIdToSections[sec.class_id] = [];
                classIdToSections[sec.class_id].push(sec.id);
            });
            const getSectionDisplayName = (sec) => {
                const siblings = classIdToSections[sec.class_id] || [];
                if (siblings.length <= 1) return `${sec.semester} ${sec.program_name}`;
                const sortedSiblings = [...siblings].sort((a, b) => a - b);
                const idx = sortedSiblings.indexOf(sec.id);
                return `${sec.semester} ${sec.program_name} B${idx + 1}`;
            };
            const getShortMergedName = (sectionsArray) => {
                const names = sectionsArray.map(s => getSectionDisplayName(s));
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

            // Build rows — collapsed merged sections into one entry each
            const processedGroupIds = new Set();
            const classes = [];
            departmentSections.forEach(sec => {
                if (sec.merge_group_id) {
                    if (!processedGroupIds.has(sec.merge_group_id)) {
                        processedGroupIds.add(sec.merge_group_id);
                        const groupSecs = departmentSections.filter(s => s.merge_group_id === sec.merge_group_id);
                        classes.push({
                            id: sec.id,
                            mergeGroupId: sec.merge_group_id,
                            allSectionIds: groupSecs.map(s => s.id),
                            name: getShortMergedName(groupSecs),
                            isMerged: true,
                            room_number: [...new Set(groupSecs.map(s => s.room_number || '-'))].join(' / '),
                            strength: groupSecs.reduce((sum, s) => sum + (s.student_strength || 0), 0),
                            capacity: Array.from(new Map(groupSecs.filter(s => s.room_number).map(s => [s.room_number, s.capacity || 0])).values()).reduce((a, b) => a + b, 0) || 0
                        });
                    }
                } else {
                    classes.push({
                        id: sec.id,
                        allSectionIds: [sec.id],
                        name: getSectionDisplayName(sec),
                        isMerged: false,
                        room_number: sec.room_number || '-',
                        strength: sec.student_strength || 0,
                        capacity: sec.capacity || 0
                    });
                }
            });
            const cleanDeptName = departmentName.replace(/^Department\s+of\s+/i, '').trim();
            return [{
                title: `Department of ${cleanDeptName} Master Timetable`,
                isMasterGrid: true,
                classes: classes,
                entries: visibleTimetable
            }];
        }

        if (reportType === 'all_departments') {
            const depts = [...new Set(departmentSections.map(s => s.department_id))];
            const results = [];

            depts.forEach(deptId => {
                const departmentName = departments.find(t => t.id === deptId)?.name || 'Department';
                const deptSecs = departmentSections.filter(s => s.department_id === deptId);

                const classIdToSections = {};
                deptSecs.forEach(sec => {
                    if (!classIdToSections[sec.class_id]) classIdToSections[sec.class_id] = [];
                    classIdToSections[sec.class_id].push(sec.id);
                });

                const getSectionDisplayName = (sec) => {
                    const siblings = classIdToSections[sec.class_id] || [];
                    if (siblings.length <= 1) return `${sec.semester} ${sec.program_name}`;
                    const sortedSiblings = [...siblings].sort((a, b) => a - b);
                    const idx = sortedSiblings.indexOf(sec.id);
                    return `${sec.semester} ${sec.program_name} B${idx + 1}`;
                };

                const getShortMergedName = (sectionsArray) => {
                    const names = sectionsArray.map(s => getSectionDisplayName(s));
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
                const classes = [];
                deptSecs.forEach(sec => {
                    if (sec.merge_group_id) {
                        if (!processedGroupIds.has(sec.merge_group_id)) {
                            processedGroupIds.add(sec.merge_group_id);
                            const groupSecs = deptSecs.filter(s => s.merge_group_id === sec.merge_group_id);
                            classes.push({
                                id: sec.id,
                                mergeGroupId: sec.merge_group_id,
                                allSectionIds: groupSecs.map(s => s.id),
                                name: getShortMergedName(groupSecs),
                                isMerged: true,
                                room_number: [...new Set(groupSecs.map(s => s.room_number || '-'))].join(' / '),
                                strength: groupSecs.reduce((sum, s) => sum + (s.student_strength || 0), 0),
                                capacity: Array.from(new Map(groupSecs.filter(s => s.room_number).map(s => [s.room_number, s.capacity || 0])).values()).reduce((a, b) => a + b, 0) || 0
                            });
                        }
                    } else {
                        classes.push({
                            id: sec.id,
                            allSectionIds: [sec.id],
                            name: getSectionDisplayName(sec),
                            isMerged: false,
                            room_number: sec.room_number || '-',
                            strength: sec.student_strength || 0,
                            capacity: sec.capacity || 0
                        });
                    }
                });

                if (classes.length > 0) {
                    const cleanDeptName = departmentName.replace(/^Department\s+of\s+/i, '').trim();
                    results.push({
                        title: `Department of ${cleanDeptName} Master Timetable`,
                        isMasterGrid: true,
                        classes: classes,
                        entries: visibleTimetable.filter(t => t.department_id === deptId)
                    });
                }
            });

            return results.sort((a, b) => a.title.localeCompare(b.title));
        }

        if (reportType === 'all_classes') {
            // Build map of section_id -> siblings count for B1/B2/B3 naming
            const classIdToSections = {};
            visibleTimetable.forEach(t => {
                if (!classIdToSections[t.class_id]) classIdToSections[t.class_id] = [];
                if (!classIdToSections[t.class_id].includes(t.section_id)) {
                    classIdToSections[t.class_id].push(t.section_id);
                }
            });
            const getSectionTitle = (t) => {
                const siblings = classIdToSections[t.class_id] || [];
                if (siblings.length <= 1) return `${t.semester} ${t.program_name}`;
                const sortedSiblings = [...siblings].sort((a, b) => a - b);
                const idx = sortedSiblings.indexOf(t.section_id);
                return `${t.semester} ${t.program_name} B${idx + 1}`;
            };
            const map = new Map();
            visibleTimetable.forEach(t => {
                if (!map.has(t.section_id)) {
                    map.set(t.section_id, {
                        title: getSectionTitle(t),
                        entries: []
                    });
                }
                map.get(t.section_id).entries.push(t);
            });
            return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title));
        }

        if (reportType === 'all_teachers') {
            const map = new Map();
            visibleTimetable.forEach(t => {
                if (!map.has(t.teacher_id)) {
                    map.set(t.teacher_id, {
                        title: `Teacher: ${t.teacher_name} (${t.teacher_short_name})`,
                        entries: []
                    });
                }
                map.get(t.teacher_id).entries.push(t);
            });
            return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title));
        }

        if (reportType === 'all_rooms') {
            const map = new Map();
            visibleTimetable.forEach(t => {
                if (!map.has(t.room_id)) {
                    map.set(t.room_id, {
                        title: `Room: ${t.room_number}`,
                        entries: []
                    });
                }
                map.get(t.room_id).entries.push(t);
            });
            return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title));
        }

        if (reportType === 'all_labs') {
            const map = new Map();
            visibleTimetable.forEach(t => {
                const isLab = t.subject_type === 'lab' || (t.subject_type === 'both' && t.lab_group_id);
                if (isLab) {
                    if (!map.has(t.room_id)) {
                        map.set(t.room_id, {
                            title: `Lab Room: ${t.room_number}`,
                            entries: []
                        });
                    }
                    map.get(t.room_id).entries.push(t);
                }
            });
            return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title));
        }

        return [];
    }, [timetable, reportType, selectedTarget, targets, departmentSections]);

    const generatedDateStr = useMemo(() => {
        if (!timetable || timetable.length === 0) return 'N/A';
        const dates = timetable.map(t => new Date(t.created_at || t.updated_at).getTime()).filter(t => !isNaN(t));
        if (dates.length > 0) {
            return new Date(Math.max(...dates)).toLocaleString('en-IN');
        }
        return 'N/A';
    }, [timetable]);

    return (
        <div>
            <PageHeader
                title="Timetable Reports"
                subtitle="Generate and export timetables"
                icon="bi-file-earmark-bar-graph"
                rightContent={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <label className="fw-medium text-muted mb-0" style={{ whiteSpace: 'nowrap', fontSize: '13px' }}>Academic Session:</label>
                        <select
                            className="form-select form-select-sm"
                            value={selectedSession}
                            onChange={e => setSelectedSession(e.target.value)}
                            style={{ minWidth: '180px', borderRadius: '6px' }}
                        >
                            <option value="">Select...</option>
                            {sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </div>
                }
            />

            <div className="card border-0 shadow-sm rounded-4 mb-4">
                <div className="card-body">
                    <div className="row g-3">
                        <div className="col-12 col-md-auto">
                            <label className="form-label fw-semibold small">Report Type</label>
                            <select className="form-select" style={{ minWidth: '100%', maxWidth: '100%' }} value={reportType} onChange={e => { setReportType(e.target.value); if (isDeptAdmin && ['department', 'all_classes', 'all_labs'].includes(e.target.value)) { setSelectedTarget(user.department_id); } }}>
                                <option value="department">Department Master Timetable</option>
                                {!isDeptAdmin && <option value="all_departments">All Departments (Master)</option>}
                                <option value="class">Specific Class</option>
                                <option value="all_classes">All Classes (Individual)</option>
                                <option value="all_labs">All Labs (Master)</option>
                                <option value="teacher">Specific Teacher</option>
                                <option value="all_teachers">All Teachers (Master)</option>
                                <option value="room">Specific Room</option>
                                <option value="all_rooms">All Rooms (Master)</option>
                            </select>
                        </div>
                        {['class', 'teacher', 'all_teachers', 'room', 'all_rooms'].includes(reportType) && !isDeptAdmin && (
                            <div className="col-12 col-md-auto">
                                <label className="form-label fw-semibold small">Filter by Department</label>
                                <select
                                    className="form-select"
                                    style={{ minWidth: '100%', maxWidth: '100%' }}
                                    value={selectedFilterDept}
                                    onChange={e => setSelectedFilterDept(e.target.value)}
                                >
                                    <option value="">All Departments</option>
                                    {departments.map(d => (
                                        <option key={d.id} value={d.id}>{d.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div className="col-12 col-md-auto">
                            <label className="form-label fw-semibold small">Select Target</label>
                            <select
                                className="form-select"
                                style={{ minWidth: '100%', maxWidth: '100%' }}
                                value={selectedTarget}
                                onChange={e => setSelectedTarget(e.target.value)}
                                disabled={!reportType || ['all_teachers', 'all_rooms', 'all_departments'].includes(reportType) || (isDeptAdmin && ['department', 'all_classes', 'all_labs'].includes(reportType))}
                            >
                                {['all_teachers', 'all_rooms', 'all_departments'].includes(reportType) ? (
                                    <option value="">All Targets Selected</option>
                                ) : (
                                    <option value="">{['department', 'all_classes', 'all_labs'].includes(reportType) ? 'Select Department...' : 'Select...'}</option>
                                )}
                                {targets.map(t => (
                                    <option key={t.id} value={t.id}>
                                        {['department', 'all_classes', 'all_labs'].includes(reportType) ? t.name : reportType === 'room' ? t.room_number : reportType === 'class' ? `${t.semester} ${t.program_name} ${t.section_name || ''}` : t.full_name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="col-12 col-xl d-flex flex-wrap align-items-end gap-2 justify-content-start justify-content-xl-end mt-3 mt-xl-0">
                            <select className="form-select border-secondary flex-grow-1 flex-sm-grow-0" style={{ width: 'auto', minWidth: '120px' }} value={orientation} onChange={(e) => setOrientation(e.target.value)}>
                                <option value="landscape">Landscape</option>
                                <option value="portrait">Portrait</option>
                            </select>
                            <button className="btn btn-outline-primary flex-grow-1 flex-sm-grow-0" onClick={handlePrint} disabled={(!selectedTarget && !['all_teachers', 'all_rooms', 'all_departments'].includes(reportType)) || timetable.length === 0}>
                                <i className="bi bi-printer me-1"></i> Print
                            </button>
                            <button className="btn btn-outline-danger flex-grow-1 flex-sm-grow-0" onClick={handleDownloadPDF} disabled={(!selectedTarget && !['all_teachers', 'all_rooms', 'all_departments'].includes(reportType)) || timetable.length === 0}>
                                <i className="bi bi-file-pdf me-1"></i> PDF
                            </button>
                            <button className="btn btn-outline-success flex-grow-1 flex-sm-grow-0" onClick={handleExportExcel} disabled={(!selectedTarget && !['all_teachers', 'all_rooms', 'all_departments'].includes(reportType)) || timetable.length === 0}>
                                <i className="bi bi-file-excel me-1"></i> Excel
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {loading && <div className="text-center p-5"><div className="spinner-border text-primary"></div></div>}

            {!loading && timetable.length > 0 && schema.days.length > 0 && (
                <div className="card border-0 shadow-sm rounded-4 overflow-hidden">
                    <style>{`
                        .report-scroll-container {
                            max-height: 720px;
                        }
                        @media (max-width: 768px) {
                            .report-scroll-container {
                                max-height: 1200px;
                            }
                        }
                    `}</style>
                    <div className="card-body p-4" ref={printRef}>
                        <style>{`
                            @media print {
                                @page { size: ${orientation}; margin: 5mm; }
                                body { font-size: 8pt !important; }
                                .page-break-before { page-break-before: always; margin-top: 10px; }
                                .report-table { font-size: 8pt !important; min-width: 100% !important; }
                                .report-table th, .report-table td { padding: 2px !important; }
                                .fw-bold { font-weight: bold !important; }
                                .small { font-size: 7pt !important; }
                                * { -webkit-print-color-adjust: exact !important; color-adjust: exact !important; }
                                .report-scroll-container { max-height: none !important; overflow: visible !important; }
                            }
                        `}</style>
                        {groupedTimetables.map((group, groupIdx) => (
                            <div key={groupIdx} className={`mb-5 ${groupIdx > 0 ? 'page-break-before' : ''}`}>
                                <div className="d-flex justify-content-between align-items-center mb-3 d-print-none">
                                    <h4 className="mb-0 fw-bold d-flex align-items-center gap-3">
                                        {group.title}
                                        {generatedDateStr && generatedDateStr !== 'N/A' && (
                                            <span className="badge bg-light text-secondary border fw-normal" style={{ fontSize: '0.85rem' }}>Generated: {generatedDateStr}</span>
                                        )}
                                    </h4>
                                    <div className="text-muted small">Generated via AKS TTMS</div>
                                </div>
                                <div className="d-none d-print-flex justify-content-center align-items-center mb-4" style={{ gap: '20px' }}>
                                    <img src={logoImg} alt="AKS Logo" style={{ width: '80px', height: '80px', objectFit: 'contain' }} />
                                    <div className="text-start">
                                        <h3 className="fw-bold m-0 p-0" style={{ fontSize: '20pt', color: '#1E3A8A' }}>AKS University</h3>
                                        <h5 className="fw-bold mt-1 mb-1" style={{ fontSize: '14pt' }}>{group.title}</h5>
                                        <div className="text-muted" style={{ fontSize: '10pt' }}>Generated on: {generatedDateStr} | Printed on: {new Date().toLocaleString('en-IN')}</div>
                                    </div>
                                </div>
                                <div className="table-responsive pb-2 report-scroll-container" style={{ width: '100%', overflowX: 'auto', overflowY: 'auto' }}>
                                    <table className="table table-bordered text-center align-middle report-table" style={{ minWidth: '1200px', fontSize: '0.85rem' }}>
                                        <thead className="table-light">
                                            <tr>
                                                <th className="bg-light text-dark fw-bold" style={{ width: '60px', fontSize: '1rem' }}>Day</th>
                                                {group.isMasterGrid && <th className="bg-light text-start text-dark fw-bold" style={{ width: '150px', fontSize: '1rem' }}>Class</th>}
                                                {schema.slots.map(s => (
                                                    <th key={s.id} className="text-dark fw-bold">
                                                        <div className="fw-bold" style={{ fontSize: '0.8rem' }}>{s.slot_type === 'break' ? 'BREAK' : `P${s.slot_order}`}</div>
                                                        <div className="small text-dark fw-bold">{s.start_time.substring(0, 5)}</div>
                                                    </th>
                                                ))}
                                                {group.isMasterGrid && <th className="bg-light text-dark fw-bold" style={{ width: '80px' }}>Room</th>}
                                                {group.isMasterGrid && <th className="bg-light text-dark fw-bold" style={{ width: '100px' }}>Strn / Cap</th>}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {group.isMasterGrid ? (
                                                schema.days.flatMap((day, dayIdx) => {
                                                    if (group.classes.length === 0) return null;
                                                    return group.classes.map((cls, classIdx) => {
                                                        const isFirstClass = classIdx === 0;
                                                        const skipSlotIds = new Set();
                                                        return (
                                                            <tr key={`${day.id}-${cls.id}`} className={dayIdx > 0 && classIdx === 0 ? "day-divider-row" : ""}>
                                                                {isFirstClass && (
                                                                    <td rowSpan={group.classes.length} className="bg-light p-0 align-top text-center" style={{ width: '60px' }}>
                                                                        <div style={{ position: 'sticky', top: '150px', writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontWeight: 'bold', margin: 'auto', paddingTop: '60px', paddingBottom: '60px', fontSize: '1.4rem' }}>
                                                                            {day.name.toUpperCase()}
                                                                        </div>
                                                                    </td>
                                                                )}
                                                                <td className="fw-bold bg-light align-middle text-start text-nowrap" style={{ whiteSpace: 'nowrap' }}>{cls.name}</td>
                                                                {schema.slots.map((slot, index) => {
                                                                    if (skipSlotIds.has(slot.id)) return null;

                                                                    if (slot.slot_type === 'break') {
                                                                        if (isFirstClass) {
                                                                            return (
                                                                                <td key={slot.id} rowSpan={group.classes.length} className="bg-light text-muted fw-bold p-0 align-top text-center" style={{ width: '60px' }}>
                                                                                    <div style={{ position: 'sticky', top: '150px', writingMode: 'vertical-rl', transform: 'rotate(180deg)', margin: 'auto', paddingTop: '60px', paddingBottom: '60px', fontSize: '1.4rem', fontWeight: 'bold' }}>
                                                                                        LUNCH
                                                                                    </div>
                                                                                </td>
                                                                            );
                                                                        }
                                                                        return null;
                                                                    }
                                                                    const isLabByCredit = (e) => {
                                                                        if (!e) return false;
                                                                        const aType = String(e.allocation_type || '').toLowerCase();
                                                                        const sType = String(e.subject_type || '').toLowerCase();
                                                                        const pCredit = Number(e.p_credit || e.weekly_practicals || 0);
                                                                        return aType === 'lab' || (aType !== 'theory' && (sType === 'lab' || sType === 'practical' || pCredit > 0 || Boolean(e.lab_group_id)));
                                                                    };
                                                                    if (!cls.isMerged) {
                                                                        const cellEntries = group.entries.filter(t => t.day_id === day.id && t.slot_order === slot.slot_order && t.section_id === cls.id);
                                                                        let colSpan = 1;
                                                                        const labEntry = cellEntries.find(e => isLabByCredit(e));
                                                                        if (labEntry) {
                                                                            const nextSlot = schema.slots[index + 1];
                                                                            if (nextSlot && nextSlot.slot_type !== 'break') {
                                                                                const hasNextSlot = group.entries.some(t =>
                                                                                    ((labEntry.lab_group_id && t.lab_group_id === labEntry.lab_group_id) || t.subject_id === labEntry.subject_id) &&
                                                                                    t.day_id === day.id && t.section_id === cls.id && t.time_slot_id === nextSlot.id
                                                                                );
                                                                                if (hasNextSlot) {
                                                                                    colSpan = 2;
                                                                                    skipSlotIds.add(nextSlot.id);
                                                                                }
                                                                            }
                                                                        }

                                                                        const firstEntry = cellEntries[0];
                                                                        const cellBgColor = firstEntry
                                                                            ? (isLibraryEntry(firstEntry) ? '#e8f4f8' : isRemedialEntry(firstEntry) ? '#fff3e0' : isSelfLearningEntry(firstEntry) ? '#e8f4f8' : getSubjectColor(firstEntry.subject_code).bg)
                                                                            : '';
                                                                        return (
                                                                            <td key={slot.id} colSpan={colSpan} className="p-0 align-middle" style={{ minWidth: `${120 * colSpan}px`, height: '100%', backgroundColor: cellBgColor }}>
                                                                                {cellEntries.length > 0 ? cellEntries.map((e, idx) => {
                                                                                    const isLib = isLibraryEntry(e);
                                                                                    const isRem = isRemedialEntry(e);
                                                                                    const colorStyle = isLib
                                                                                        ? { bg: '#e8f4f8', border: '#90cce0', text: '#1a6b8a' }
                                                                                        : isRem
                                                                                            ? { bg: '#fff3e0', border: '#ffcc80', text: '#e65100' }
                                                                                            : getSubjectColor(e.subject_code);
                                                                                    const isLab = !isLib && !isRem && isLabByCredit(e);
                                                                                    const baseName = e.subject_name || e.subject_code;
                                                                                    const shortName = getShortSubjectName(baseName);
                                                                                    const labDisplayName = isLib ? 'Library' : isRem ? 'REMEDIAL' : isSelfLearningEntry(typeof e !== 'undefined' ? e : (typeof e0 !== 'undefined' ? e0 : (typeof entry !== 'undefined' ? entry : null))) ? 'Self Learning' : (isLab ? (String(shortName || '').toLowerCase().includes('lab') ? shortName : `${shortName} Lab`) : (e.subject_code || e.subject_name || ''));

                                                                                    const tags = [];
                                                                                    if (!isLib && !isRem && Number(e.is_online) === 1) tags.push('ONLINE');
                                                                                    if (!isLib && !isRem && isNptelSubject(e)) tags.push('MOOC');
                                                                                    const tagStr = tags.length > 0 ? ` {${tags.join(', ')}}` : '';
                                                                                    const roomStr = isLib ? '' : (e.room_number && (isLab || e.room_number !== cls.room_number)) ? `[${e.room_number}]` : (e.room_number ? `[${e.room_number}]` : '');

                                                                                    return (
                                                                                        <div key={idx} className={`p-0 px-1 ${idx < cellEntries.length - 1 ? 'border-bottom border-dark-subtle' : ''} d-flex flex-column justify-content-center h-100 py-1`} style={{ minHeight: '32px', overflow: 'hidden' }}>
                                                                                            <div className="fw-bold text-truncate" style={{ color: colorStyle.text, fontSize: '12px' }} title={baseName}>
                                                                                                {labDisplayName}{roomStr}
                                                                                                {tags.length > 0 && <span className="text-primary ms-1">{tagStr}</span>}
                                                                                            </div>
                                                                                            {!isLib && (
                                                                                                <div className="text-dark fw-bold text-truncate" style={{ fontSize: '13px' }} title={isRem ? 'Class Teacher' : (isSelfLearningEntry(typeof e !== 'undefined' ? e : (typeof e0 !== 'undefined' ? e0 : (typeof entry !== 'undefined' ? entry : null))) || isLib) ? '' : e.teacher_name}>
                                                                                                    {isRem ? 'Class Teacher' : (isSelfLearningEntry(typeof e !== 'undefined' ? e : (typeof e0 !== 'undefined' ? e0 : (typeof entry !== 'undefined' ? entry : null))) || isLib) ? '' : (isLab ? (e.teacher_name || e.teacher_short_name || 'N/A') : (e.teacher_short_name || 'N/A'))}
                                                                                                </div>
                                                                                            )}
                                                                                        </div>
                                                                                    );
                                                                                }) : null}
                                                                            </td>
                                                                        );
                                                                    }

                                                                    // MERGED ROW LOGIC
                                                                    const allEntries = cls.allSectionIds.flatMap(secId =>
                                                                        group.entries.filter(t => t.day_id === day.id && t.slot_order === slot.slot_order && t.section_id === secId)
                                                                    );

                                                                    let colSpan = 1;
                                                                    const labEntry = allEntries.find(e => isLabByCredit(e));
                                                                    if (labEntry) {
                                                                        const nextSlot = schema.slots[index + 1];
                                                                        if (nextSlot && nextSlot.slot_type !== 'break') {
                                                                            const hasNextSlot = cls.allSectionIds.some(secId =>
                                                                                group.entries.some(t =>
                                                                                    ((labEntry.lab_group_id && t.lab_group_id === labEntry.lab_group_id) || t.subject_id === labEntry.subject_id) &&
                                                                                    t.day_id === day.id && t.section_id === secId && t.time_slot_id === nextSlot.id
                                                                                )
                                                                            );
                                                                            if (hasNextSlot) { colSpan = 2; skipSlotIds.add(nextSlot.id); }
                                                                        }
                                                                    }

                                                                    if (allEntries.length === 0) {
                                                                        return <td key={slot.id} colSpan={colSpan} className="p-0" style={{ minWidth: `${120 * colSpan}px` }}></td>;
                                                                    }

                                                                    const cleanName = (name) => String(name || '').replace(/^(SEC|MDC|VAC|AEC|C|M|DSE|GE|CC|DSC)[-\s\d:]+/i, '').trim().toLowerCase();
                                                                    const subjectMap = new Map();
                                                                    allEntries.forEach(e => {
                                                                        const key = `${cleanName(e.subject_name || e.subject_code)}_${e.teacher_id}_${e.room_id}`;
                                                                        if (!subjectMap.has(key)) subjectMap.set(key, []);
                                                                        subjectMap.get(key).push(e);
                                                                    });

                                                                    const cards = Array.from(subjectMap.entries()).map(([subjectId, entries], cardIdx) => {
                                                                        const e0 = entries[0];
                                                                        const isLib = isLibraryEntry(e0);
                                                                        const isRem = isRemedialEntry(e0);
                                                                        const colorStyle = isLib
                                                                            ? { bg: '#e8f4f8', border: '#90cce0', text: '#1a6b8a' }
                                                                            : isRem
                                                                                ? { bg: '#fff3e0', border: '#ffcc80', text: '#e65100' }
                                                                                : getSubjectColor(e0.subject_code);
                                                                        const isLab = !isLib && !isRem && isLabByCredit(e0);
                                                                        const baseName0 = e0.subject_name || e0.subject_code;
                                                                        const shortName = getShortSubjectName(baseName0);
                                                                        const displayName = isLib ? 'Library' : isRem ? 'REMEDIAL' : isSelfLearningEntry(typeof e !== 'undefined' ? e : (typeof e0 !== 'undefined' ? e0 : (typeof entry !== 'undefined' ? entry : null))) ? 'Self Learning' : (isLab ? (String(shortName || '').toLowerCase().includes('lab') ? shortName : `${shortName} Lab`) : (e0.subject_code || e0.subject_name || ''));
                                                                        const isShared = entries.length === cls.allSectionIds.length;
                                                                        const rooms = [...new Set(entries.map(e => formatRoomName(e)).filter(Boolean))];

                                                                        const homeRooms = cls.room_number ? cls.room_number.split(' / ') : [];
                                                                        const isHomeRoom = rooms.length > 0 && rooms.every(r => homeRooms.includes(r));
                                                                        const shouldShowRoom = !isShared || !isHomeRoom;

                                                                        const tags = [];
                                                                        if (!isLib && !isRem && Number(e0.is_online) === 1) tags.push('ONLINE');
                                                                        if (!isLib && !isRem && isNptelSubject(e0)) tags.push('MOOC');
                                                                        const tagStr = tags.length > 0 ? ` {${tags.join(', ')}}` : '';

                                                                        return (
                                                                            <div key={cardIdx} className={`p-0 px-1 ${cardIdx < subjectMap.size - 1 ? 'border-bottom border-dark-subtle' : ''} d-flex flex-column justify-content-center h-100 py-1`}
                                                                                style={{ minHeight: '32px', overflow: 'hidden' }}>
                                                                                <div className="fw-bold text-truncate" style={{ color: colorStyle.text, fontSize: '12px' }} title={baseName0}>
                                                                                    {displayName}
                                                                                    {rooms.length > 0 && shouldShowRoom && !isLib && (
                                                                                        <span className="ms-1" style={{ fontSize: '12px' }}>
                                                                                            {isShared ? rooms.map((r, ri) => <React.Fragment key={ri}>{ri > 0 ? ', ' : ''}{renderRoomBadge(r)}</React.Fragment>) : rooms.map((r, ri) => <span key={ri} className="me-1">{renderRoomBadge(r)}</span>)}
                                                                                        </span>
                                                                                    )}
                                                                                    {tags.length > 0 && <span className="text-primary ms-1">{tagStr}</span>}
                                                                                </div>
                                                                                {!isLib && (
                                                                                    <div className="text-dark fw-bold text-truncate" style={{ fontSize: '13px' }} title={isRem ? 'Class Teacher' : (isSelfLearningEntry(typeof e !== 'undefined' ? e : (typeof e0 !== 'undefined' ? e0 : (typeof entry !== 'undefined' ? entry : null))) || isLib) ? '' : e0.teacher_name}>
                                                                                        {isRem ? 'Class Teacher' : (isSelfLearningEntry(typeof e !== 'undefined' ? e : (typeof e0 !== 'undefined' ? e0 : (typeof entry !== 'undefined' ? entry : null))) || isLib) ? '' : (isLab ? (e0.teacher_name || e0.teacher_short_name || 'N/A') : (e0.teacher_short_name || 'N/A'))}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    });

                                                                    const firstCardEntry = Array.from(subjectMap.values())[0]?.[0];
                                                                    const cellBgColor = firstCardEntry
                                                                        ? (isLibraryEntry(firstCardEntry) ? '#e8f4f8' : isRemedialEntry(firstCardEntry) ? '#fff3e0' : isSelfLearningEntry(firstCardEntry) ? '#e8f4f8' : getSubjectColor(firstCardEntry.subject_code).bg)
                                                                        : '';

                                                                    return (
                                                                        <td key={slot.id} colSpan={colSpan} className="p-0 align-middle" style={{ minWidth: `${120 * colSpan}px`, height: '100%', backgroundColor: cellBgColor }}>
                                                                            {cards}
                                                                        </td>
                                                                    );
                                                                })}
                                                                <td className="bg-light text-center fw-bold align-middle text-muted">{cls.room_number}</td>
                                                                <td className="bg-light text-center align-middle">
                                                                    <span className={cls.strength > cls.capacity && cls.capacity > 0 ? 'text-danger fw-bold' : ''}>{cls.strength}</span> / {cls.capacity || '-'}
                                                                </td>
                                                            </tr>
                                                        );
                                                    });
                                                })
                                            ) : (
                                                schema.days.map(day => {
                                                    const skipSlotIds = new Set();
                                                    return (
                                                        <tr key={day.id}>
                                                            <td className="fw-bold bg-light">{day.name}</td>
                                                            {schema.slots.map((slot, index) => {
                                                                if (skipSlotIds.has(slot.id)) return null;

                                                                if (slot.slot_type === 'break') {
                                                                    return <td key={slot.id} className="bg-light text-muted small">LUNCH</td>;
                                                                }
                                                                const cellEntries = group.entries.filter(t => t.day_id === day.id && t.slot_order === slot.slot_order);

                                                                let colSpan = 1;
                                                                const labEntry = cellEntries.find(e => e.lab_group_id);
                                                                if (labEntry) {
                                                                    const nextSlot = schema.slots[index + 1];
                                                                    if (nextSlot && nextSlot.slot_type !== 'break') {
                                                                        const hasNextSlot = group.entries.some(t => t.lab_group_id === labEntry.lab_group_id && t.day_id === day.id && t.time_slot_id === nextSlot.id);
                                                                        if (hasNextSlot) {
                                                                            colSpan = 2;
                                                                            skipSlotIds.add(nextSlot.id);
                                                                        }
                                                                    }
                                                                }

                                                                return (
                                                                    <td key={slot.id} colSpan={colSpan} className="p-1" style={{ minWidth: `${120 * colSpan}px` }}>
                                                                        {cellEntries.length > 0 ? cellEntries.map((e, idx) => {
                                                                            const isLib = isLibraryEntry(e);
                                                                            const isRem = isRemedialEntry(e);
                                                                            const colorStyle = isLib 
                                                                                ? { bg: '#e8f4f8', border: '#90cce0', text: '#1a6b8a' } 
                                                                                : isRem 
                                                                                    ? { bg: '#fff3e0', border: '#ffcc80', text: '#e65100' } 
                                                                                    : getSubjectColor(e.subject_code);
                                                                            const isLab = !isLib && !isRem && (e.subject_type === 'lab' || (e.subject_type === 'both' && e.lab_group_id));
                                                                            return (
                                                                                <div key={idx} className={`p-2 rounded ${idx < cellEntries.length - 1 ? 'mb-2' : ''} h-100 d-flex flex-column justify-content-center`} style={{ backgroundColor: colorStyle.bg, border: `1px solid ${colorStyle.border}`, minHeight: '60px' }}>
                                                                                    <div className="fw-bold" style={{ color: colorStyle.text, fontSize: '12px' }}>{isLib ? 'Library' : isRem ? 'REMEDIAL' : isSelfLearningEntry(typeof e !== 'undefined' ? e : (typeof e0 !== 'undefined' ? e0 : (typeof entry !== 'undefined' ? entry : null))) ? 'Self Learning' : (isLab ? (e.subject_name || e.subject_code) : e.subject_code)}</div>
                                                                                    {!isLib && (
                                                                                        <div className="fw-bold text-dark" style={{ fontSize: '13px' }}>{isRem ? 'Class Teacher' : (isSelfLearningEntry(typeof e !== 'undefined' ? e : (typeof e0 !== 'undefined' ? e0 : (typeof entry !== 'undefined' ? entry : null))) || isLib) ? '' : (isLab ? (e.teacher_name || e.teacher_short_name) : e.teacher_short_name)}</div>
                                                                                    )}
                                                                                    {e.room_number && <div className="fw-bold mt-1" style={{ color: colorStyle.text, fontSize: '12px' }}>{renderRoomBadge(formatRoomName(e))}</div>}
                                                                                    {Number(e.is_online) === 1 && (
                                                                                        <span className="badge bg-primary text-white mt-1 d-inline-block shadow-sm" style={{ fontSize: '9px', width: 'fit-content', margin: '0 auto' }}>
                                                                                            <i className="bi bi-wifi me-1"></i>ONLINE
                                                                                        </span>
                                                                                    )}
                                                                                    {isNptelSubject(e) && (
                                                                                        <span className="badge bg-danger text-white mt-1 d-inline-block shadow-sm" style={{ fontSize: '9px', width: 'fit-content', margin: '0 auto' }}>
                                                                                            MOOC / NPTEL
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                            );
                                                                        }) : null}
                                                                    </td>
                                                                );
                                                            })}
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                        {(() => {
                                            if (!group.isMasterGrid) return null;
                                            
                                            const uniqueTeachersMap = new Map();
                                            (group.entries || []).forEach(t => {
                                                if (t.teacher_name && t.teacher_short_name) {
                                                    uniqueTeachersMap.set(t.teacher_short_name, t.teacher_name);
                                                }
                                            });
                                            
                                            if (uniqueTeachersMap.size === 0) return null;
                                            
                                            const teacherList = Array.from(uniqueTeachersMap.entries())
                                                .sort((a, b) => a[0].localeCompare(b[0]));
                                                
                                            const legendText = "Faculty Legend: " + teacherList.map(([short, full]) => `${short} = ${full}`).join('  |  ');
                                                
                                            return (
                                                <tfoot className="d-print-table-row-group">
                                                    <tr>
                                                        <td colSpan={100} className="text-start bg-light p-2" style={{ borderTop: '2px solid #dee2e6' }}>
                                                            <div className="fw-bold text-dark" style={{ fontSize: '11px', whiteSpace: 'normal', wordWrap: 'break-word' }}>
                                                                {legendText}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                </tfoot>
                                            );
                                        })()}
                                    </table>
                                    {(() => {
                                        const nptelSubjects = Array.from(new Set(
                                            (group.entries || [])
                                                .filter(t => isNptelSubject(t))
                                                .map(t => `${t.subject_name} (${t.subject_code})`)
                                        ));
                                        if (nptelSubjects.length > 0) {
                                            return (
                                                <div className="mt-2 p-2 bg-danger bg-opacity-10 border border-danger border-opacity-25 rounded d-flex align-items-center gap-2">
                                                    <i className="bi bi-laptop text-danger"></i>
                                                    <div style={{ fontSize: '12px' }}>
                                                        <span className="fw-bold text-danger">NPTEL / MOOC Course Note: </span>
                                                        <span className="text-dark">
                                                            Conducted via NPTEL/SWAYAM (MOOC), scheduled for 1 interactive session/week: <strong>{nptelSubjects.join(', ')}</strong>.
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        }
                                        return null;
                                    })()}

                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {!loading && timetable.length === 0 && (selectedTarget || reportType.startsWith('all_')) && (
                <div className="text-center py-5 text-muted">
                    No timetable found for the selected target.
                </div>
            )}
        </div>
    );
};

export default TimetableReports;
