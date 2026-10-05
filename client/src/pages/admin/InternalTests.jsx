import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import api from '../../utils/api';
import PageHeader from '../../components/common/PageHeader';
import DataTable from '../../components/common/DataTable';
import FormModal from '../../components/common/FormModal';
import { useAuth } from '../../context/AuthContext';
import ActionButtons from '../../components/common/ActionButtons';
import Swal from 'sweetalert2';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

const InternalTests = () => {
    const { user } = useAuth();
    const [tests, setTests] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [rooms, setRooms] = useState([]);
    const [classes, setClasses] = useState([]);
    const [sections, setSections] = useState([]);
    const [subjects, setSubjects] = useState([]);
    const [teachers, setTeachers] = useState([]);
    const [availableTheoryInvigilators, setAvailableTheoryInvigilators] = useState([]);
    const [availableLabInvigilators, setAvailableLabInvigilators] = useState([]);
    const [addedSubjects, setAddedSubjects] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [selectedSession, setSelectedSession] = useState('');

    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [viewModalOpen, setViewModalOpen] = useState(false);
    const [viewData, setViewData] = useState(null);
    const [filterDepartment, setFilterDepartment] = useState('');
    const [showHistory, setShowHistory] = useState(false);
    const [analysisModalOpen, setAnalysisModalOpen] = useState(false);
    const [analysisPage, setAnalysisPage] = useState(1);
    const [analysisDeptFilter, setAnalysisDeptFilter] = useState('');

    // --- Report Printing / PDF Logic ---
    // Normalize raw DB data (has room_ids CSV, invigilator_name string) into report-ready object
    const buildReportData = (data, resolvedRooms, resolvedTeachers, resolvedSections) => {
        if (!data) return null;
        // Resolve rooms
        let roomsStr = '';
        if (data.room_ids) {
            const ids = String(data.room_ids).split(',').map(Number).filter(Boolean);
            roomsStr = ids.map(id => {
                const r = resolvedRooms.find(rm => rm.id === id);
                return r ? `${r.building} - ${r.room_number}` : '';
            }).filter(Boolean).join(', ');
        } else if (data.rooms) {
            roomsStr = data.rooms; // already resolved (from save)
        }
        // Resolve invigilators
        let invigsStr = '';
        if (data.invigilator_name) {
            invigsStr = data.invigilator_name;
        } else if (data.invigilator_ids) {
            const ids = String(data.invigilator_ids).split(',').map(Number).filter(Boolean);
            invigsStr = ids.map(id => {
                const t = resolvedTeachers.find(tc => tc.id === id);
                return t ? t.short_name || t.full_name : '';
            }).filter(Boolean).join(', ');
        }
        // Resolve sections
        let sectionsStr = '';
        if (data.section_ids) {
            const ids = String(data.section_ids).split(',').map(Number).filter(Boolean);
            sectionsStr = ids.map(id => {
                const s = resolvedSections.find(sc => sc.id === id);
                return s ? s.section_name : '';
            }).filter(Boolean).join(', ');
        }
        return {
            ...data,
            rooms: roomsStr || 'TBA',
            invigilators: invigsStr || 'N/A',
            sections_display: sectionsStr,
            class_name: data.class_name || '',
            department_name: data.department_name || '',
            subject_name: data.subject_name || '',
            subject_code: data.subject_code || '',
            // Build subjects array for multi-subject report
            subjects_list: (() => {
                if (data.subjects_list && Array.isArray(data.subjects_list)) return data.subjects_list;
                return [{ name: data.subject_name || 'N/A', code: data.subject_code || 'N/A' }];
            })(),
        };
    };

    const openReportWindow = async (reportData, isPdf = false) => {
        if (!reportData) return;

        const result = await Swal.fire({
            title: 'Include Invigilators?',
            text: "Do you want to show invigilator names and the legend in the document?",
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#3b82f6',
            cancelButtonColor: '#64748b',
            confirmButtonText: 'Yes, Include',
            cancelButtonText: 'No, Skip'
        });
        const includeInvigs = result.isConfirmed;

        
        // Parse subject timings if it's a string (from DB)
        const timings = typeof reportData.subject_timings === 'string' 
            ? (() => { try { return JSON.parse(reportData.subject_timings); } catch { return {}; } })()
            : (reportData.subject_timings || {});

        const formatRooms = (roomIds) => {
            if (!roomIds || roomIds.length === 0) return reportData.rooms; // fallback to global
            const ids = Array.isArray(roomIds) ? roomIds : String(roomIds).split(',').map(Number).filter(Boolean);
            const roomsByBlock = {};
            ids.forEach(id => {
                const r = rooms.find(rm => rm.id === id);
                if (r) {
                    if (!roomsByBlock[r.building]) roomsByBlock[r.building] = [];
                    roomsByBlock[r.building].push(r.room_number);
                }
            });
            const parts = [];
            for (const [block, numbers] of Object.entries(roomsByBlock)) {
                parts.push(`${block} - ${numbers.join(', ')}`);
            }
            return parts.join(' | ') || reportData.rooms;
        };

        const formatInvigs = (theoryIds, labIds) => {
            if (!includeInvigs) return '';
            let allIds = [...(theoryIds || []), ...(labIds || [])];
            // FALLBACK for old records
            if (allIds.length === 0 && reportData.invigilator_ids) {
                allIds = String(reportData.invigilator_ids).split(',').map(Number).filter(Boolean);
            }
            if (allIds.length === 0) return '';
            const names = allIds.map(id => {
                const t = teachers.find(tc => tc.id === id);
                return t ? (t.short_name || t.full_name) : '';
            }).filter(Boolean);
            return names.length > 0 ? `(${names.join(', ')})` : '';
        };

        const legendMap = {}; // mapping short_name -> { full_name, emp_id }
        const addLegend = (ids) => {
            if (!includeInvigs || !ids) return;
            ids.forEach(id => {
                const t = teachers.find(tc => tc.id === id);
                if (t) {
                    legendMap[t.short_name || t.full_name] = { 
                        name: t.full_name, 
                        emp_id: t.employee_id || 'N/A' 
                    };
                }
            });
        };

        const logoUrl = '/logo.png'; // served from public folder
        const formatDate = (ds) => {
            if (!ds) return '';
            const d = new Date(ds);
            return d.toLocaleDateString('en-GB');
        };
        const getDayName = (ds) => {
            if (!ds) return '';
            const d = new Date(ds);
            return d.toLocaleDateString('en-GB', { weekday: 'long' });
        };
        const getMonthYear = (ds) => {
            if (!ds) return '';
            const d = new Date(ds);
            const month = d.toLocaleString('en-GB', { month: 'long' }).toUpperCase();
            return `${month}-${d.getFullYear()}`;
        };

        const subjects = reportData.subjects_list || [{ id: reportData.subject_id, name: reportData.subject_name || 'N/A', code: reportData.subject_code || 'N/A', start_time: reportData.start_time, end_time: reportData.end_time, test_date: reportData.test_date }];
        
        // Enrich subjects with room and invigilator formatting from timings
        subjects.forEach(s => {
            if (s.id && timings[s.id]) {
                const t = timings[s.id];
                s.roomStr = formatRooms(t.room_ids);
                s.invigStr = formatInvigs(t.theory_invigilator_ids, t.lab_invigilator_ids);
                addLegend(t.theory_invigilator_ids);
                addLegend(t.lab_invigilator_ids);
            } else {
                s.roomStr = reportData.rooms;
                s.invigStr = '';
            }
        });

        // Global legend for fallback if no per-subject timings exist
        if (Object.keys(legendMap).length === 0 && reportData.invigilator_ids) {
            addLegend(String(reportData.invigilator_ids).split(',').map(Number).filter(Boolean));
        }

        // Sort by Date then Start Time
        subjects.sort((a, b) => {
            const dateA = new Date(`${a.test_date || reportData.test_date}T${a.start_time || reportData.start_time}`);
            const dateB = new Date(`${b.test_date || reportData.test_date}T${b.start_time || reportData.start_time}`);
            return dateA - dateB;
        });

        // Determine if there are multiple dates
        const dates = subjects.map(s => s.test_date || reportData.test_date);
        const uniqueDates = [...new Set(dates)];
        const hasMultipleDates = uniqueDates.length > 1;

        const globalDateStr = formatDate(new Date());
        const startTime = (reportData.start_time || '').substring(0, 5);
        const endTime = (reportData.end_time || '').substring(0, 5);

        const noticeMonthYear = new Date(reportData.test_date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
        const isOnline = reportData.test_type?.toLowerCase().includes('online');

        const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Exam Notice - ${reportData.test_name}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; background: white; }
    .header { display: flex; align-items: center; border-bottom: 2px solid #1e3a8a; padding-bottom: 15px; margin-bottom: 20px; }
    .header img { height: 80px; margin-right: 20px; }
    .header-text { text-align: center; flex: 1; }
    .header-text h1 { margin: 0; color: #1e3a8a; font-size: 24px; text-transform: uppercase; }
    .header-text h2 { margin: 5px 0 0; color: #666; font-size: 16px; font-weight: normal; }
    .notice-title { text-align: center; margin-bottom: 30px; }
    .notice-title h3 { margin: 0; color: #dc2626; font-size: 20px; text-decoration: underline; text-underline-offset: 4px; }
    .notice-title h4 { margin: 5px 0 0; font-size: 14px; color: #000; text-transform: uppercase; }
    .meta { display: flex; justify-content: space-between; margin-bottom: 20px; font-weight: bold; font-size: 14px; }
    .intro { margin-bottom: 20px; text-align: justify; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 13px; }
    th, td { border: 1px solid #ccc; padding: 10px; text-align: left; }
    th { background-color: #f1f5f9; color: #0f172a; font-weight: 600; }
    td small { color: #64748b; }
    .instructions { font-size: 13px; margin-bottom: 50px; }
    .instructions h5 { font-size: 14px; margin: 0 0 10px; text-decoration: underline; }
    .instructions ul { padding-left: 20px; margin: 0; }
    .instructions li { margin-bottom: 5px; }
    .signatures { display: flex; justify-content: space-between; margin-top: 50px; }
    .sig { text-align: center; width: 200px; }
    .sig-line { border-top: 1px solid #000; margin-bottom: 5px; }
    .sig strong { display: block; font-size: 14px; }
    .sig small { font-size: 12px; color: #666; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; padding: 0; }
      @page { margin: 15mm; }
    }
  </style>
</head>
<body>
  <div class="header">
    <img src="${window.location.origin}/logo.png" alt="Logo" onerror="this.style.display='none'" />
    <div class="header-text">
      <h1>AKS University, Satna</h1>
      <h2>Department of ${reportData.department_name || 'Computer Science and Engineering'}</h2>
    </div>
  </div>

  <div class="notice-title">
    <h3>EXAM NOTICE</h3>
    <h4>${(reportData.test_type || 'INTERNAL EXAM').toUpperCase()} (${noticeMonthYear})</h4>
  </div>

  <div class="meta">
    <div>Ref No: <span>${reportData.ref_id || 'N/A'}</span></div>
    <div>Date: <span>${globalDateStr}</span></div>
  </div>

  <p class="intro">
    This is to notify that the <strong>${reportData.test_type || 'Internal Test'}</strong> for
    <strong>${reportData.class_name || ''}${reportData.sections_display ? ' (' + reportData.sections_display + ')' : ''}</strong>
    will be conducted as per the following schedule. All concerned students and invigilators must strictly adhere to the timings.
  </p>

  <table>
    <thead>
      <tr>
        <th>S.No.</th>
        <th>Class</th>
        ${hasMultipleDates ? '<th>Date &amp; Day</th>' : ''}
        <th>Timing</th>
        <th>Subject</th>
        <th>Room / Lab</th>
      </tr>
    </thead>
    <tbody>
      ${subjects.map((sub, idx) => {
            const subStart = (sub.start_time || startTime || '').substring(0, 5);
            const subEnd = (sub.end_time || endTime || '').substring(0, 5);
            const subDate = sub.test_date || reportData.test_date;
            return `
      <tr>
        <td style="text-align:center">${idx + 1}</td>
        <td>${reportData.class_name || 'N/A'}</td>
        ${hasMultipleDates ? `<td>${formatDate(subDate)}<br><small>${getDayName(subDate)}</small></td>` : ''}
        <td style="white-space:nowrap">${subStart} - ${subEnd}</td>
        <td>${sub.name || 'N/A'}<br><small>(${sub.code || 'N/A'})</small></td>
        <td>${sub.roomStr || reportData.rooms || 'TBA'}${sub.invigStr ? `<br><small><strong>${sub.invigStr}</strong></small>` : ''}</td>
      </tr>`;
        }).join('')}
    </tbody>
  </table>

  <div class="instructions">
    <h5>Important Instructions:</h5>
    <ul>
      <li>Students must report to the examination venue at least 15 minutes prior to the start time.</li>
      <li>ID cards are strictly mandatory for entry.</li>
      <li>Use of electronic gadgets (unless explicitly permitted for online tests) is strictly prohibited.</li>
      ${isOnline ? '<li>For online exams, students must ensure their login credentials are active before the exam.</li>' : ''}
    </ul>
  </div>
</body>
</html>`;

        if (isPdf) {
            const iframe = document.createElement('iframe');
            iframe.style.position = 'absolute';
            iframe.style.width = '800px';
            iframe.style.height = '1200px';
            iframe.style.left = '-9999px';
            document.body.appendChild(iframe);
            iframe.contentDocument.write(html);
            iframe.contentDocument.close();

            setTimeout(() => {
                html2canvas(iframe.contentDocument.body, { scale: 2, useCORS: true }).then(canvas => {
                    const imgData = canvas.toDataURL('image/png');
                    const pdf = new jsPDF('p', 'mm', 'a4');
                    const pdfWidth = pdf.internal.pageSize.getWidth();
                    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
                    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
                    pdf.save(`Exam_Notice_${reportData.ref_id || 'Notice'}.pdf`);
                    document.body.removeChild(iframe);
                }).catch(err => {
                    toast.error("Failed to generate PDF");
                    document.body.removeChild(iframe);
                });
            }, 800);
            return;
        }

        const win = window.open('', '_blank', 'width=900,height=700');
        if (!win) { toast.error('Pop-up blocked! Please allow pop-ups.'); return; }
        win.document.write(html);
        win.document.close();
        win.onload = () => { win.focus(); win.print(); };
    };

    const [formData, setFormData] = useState({
        department_id: '',
        session_id: '',
        block_name: '',
        room_ids: [],
        class_ids: [],
        section_ids: [],
        subject_id: '',
        subject_ids: [],
        subject_part: '',
        subject_timings: {}, // { subjectId: { start_time, end_time } }
        use_per_subject_timing: false,
        theory_invigilator_ids: [],
        lab_invigilator_ids: [],
        test_type: '',
        test_name: '',
        ref_id: '',
        test_date: '',
        start_time: '',
        end_time: ''
    });

    const isDepartmentAdmin = ['DEPARTMENT_ADMIN', 'FACULTY'].includes(user?.role);
    const deptId = user?.department_id;

    useEffect(() => {
        fetchInitialData();
    }, []);

    useEffect(() => {
        if (selectedSession) {
            fetchTests(selectedSession);
        }
    }, [selectedSession]);

    // Fetch available invigilators based on Date/Time
    useEffect(() => {
        const fetchInvigilators = async () => {
            let freeTeachers = teachers;

            if (formData.test_date && formData.start_time && formData.end_time) {
                try {
                    const res = await api.get(`/internal-tests/available-teachers?date=${formData.test_date}&start_time=${formData.start_time}&end_time=${formData.end_time}`);
                    freeTeachers = res.data || [];
                } catch (error) {
                    console.error('Failed to load invigilators', error);
                }
            }

            const cseDept = departments.find(d => d.name.toLowerCase().includes('computer science') || d.short_code?.toUpperCase() === 'CSE' || d.short_code?.toUpperCase() === 'CSAE');
            const cseDeptId = cseDept ? cseDept.id : null;
            const selDeptId = parseInt(formData.department_id || deptId || 0);
            const isOnline = formData.test_type === 'Online Class Test' || formData.test_type === 'Online Class Retest';

            const theory = freeTeachers.filter(t => {
                const isLabFaculty = (t.designation || '').toLowerCase().includes('lab') || (t.designation || '').toLowerCase().includes('instructor') || (t.designation || '').toLowerCase().includes('associate');
                return !isLabFaculty && (selDeptId ? t.department_id === selDeptId : true);
            });

            const labs = freeTeachers.filter(t => {
                const isLabFaculty = (t.designation || '').toLowerCase().includes('lab') || (t.designation || '').toLowerCase().includes('instructor') || (t.designation || '').toLowerCase().includes('associate');
                const targetDeptId = isOnline ? cseDeptId : selDeptId;
                return isLabFaculty && (targetDeptId ? t.department_id === targetDeptId : true);
            });

            setAvailableTheoryInvigilators(theory);
            setAvailableLabInvigilators(labs);
        };
        fetchInvigilators();
    }, [formData.test_date, formData.start_time, formData.end_time, formData.department_id, formData.test_type, departments, deptId, teachers]);

    // Auto-sync global Start/End Time and Date from per-subject timings
    useEffect(() => {
        if (!formData.use_per_subject_timing) return;
        const selectedIds = formData.subject_ids || [];
        if (selectedIds.length === 0) return;

        const timings = formData.subject_timings || {};
        const starts = selectedIds.map(id => timings[id]?.start_time).filter(Boolean);
        const ends = selectedIds.map(id => timings[id]?.end_time).filter(Boolean);
        const dates = selectedIds.map(id => timings[id]?.test_date).filter(Boolean);

        let updates = {};
        if (starts.length > 0 && ends.length > 0) {
            updates.start_time = starts.reduce((a, b) => a < b ? a : b);
            updates.end_time = ends.reduce((a, b) => a > b ? a : b);
        }
        if (dates.length > 0) {
            // Sync global date to the earliest selected date
            updates.test_date = dates.reduce((a, b) => new Date(a) < new Date(b) ? a : b);
        }

        if (Object.keys(updates).length > 0) {
            setFormData(prev => ({ ...prev, ...updates }));
        }
    }, [formData.subject_timings, formData.use_per_subject_timing, formData.subject_ids]);

    const fetchInitialData = async () => {
        setLoading(true);
        try {
            const [deptRes, roomsRes, classesRes, sectionsRes, sessionsRes, subjectsRes, teachersRes] = await Promise.all([
                api.get('/departments?limit=100'),
                api.get('/rooms?limit=1000'),
                api.get('/classes?limit=1000'),
                api.get('/classes/all-sections'),
                api.get('/sessions'),
                api.get('/subjects?limit=2000'),
                api.get('/teachers?limit=1000').catch(() => ({ data: { data: [] } }))
            ]);

            setDepartments(deptRes.data.data || deptRes.data);
            setRooms(roomsRes.data.data || roomsRes.data);
            setClasses(classesRes.data.data || classesRes.data);
            setSections(sectionsRes.data.data || sectionsRes.data);
            setSubjects(subjectsRes.data.data || subjectsRes.data);
            setTeachers(teachersRes.data.data || teachersRes.data);

            const fetchedSessions = sessionsRes.data.data || sessionsRes.data;
            setSessions(fetchedSessions);

            const activeSession = fetchedSessions.find(s => s.is_active);
            if (activeSession) {
                setSelectedSession(activeSession.id);
            } else if (fetchedSessions.length > 0) {
                setSelectedSession(fetchedSessions[0].id);
            }
        } catch (error) {
            toast.error('Failed to load initial data');
        } finally {
            setLoading(false);
        }
    };

    const fetchTests = async (sessionId) => {
        setLoading(true);
        try {
            const testsRes = await api.get(`/internal-tests?session_id=${sessionId}`);
            let filteredTests = testsRes.data;
            if (isDepartmentAdmin) {
                filteredTests = testsRes.data.filter(t => t.department_id === deptId || t.department_id === null);
            }
            setTests(filteredTests);
        } catch (error) {
            toast.error('Failed to load internal tests data');
        } finally {
            setLoading(false);
        }
    };

    const handleOpenModal = () => {
        setIsEditMode(false);
        setFormData({
            department_id: isDepartmentAdmin ? deptId : '',
            session_id: selectedSession,
            block_name: '',
            room_ids: [],
            class_ids: [],
            section_ids: [],
            subject_id: '',
            theory_invigilator_ids: [],
            lab_invigilator_ids: [],
            test_type: '',
            test_name: '',
            ref_id: '',
            test_date: '',
            start_time: '',
            end_time: '',
            registered_students: ''
        });
        setAddedSubjects([]);
        setAvailableTheoryInvigilators([]);
        setAvailableLabInvigilators([]);
        setModalOpen(true);
    };

    useEffect(() => {
        const fetchAvailableInvigilators = async () => {
            if (formData.test_date && formData.start_time && formData.end_time && (formData.department_id || deptId) && selectedSession) {
                try {
                    const response = await api.get('/internal-tests/available-teachers', {
                        params: {
                            date: formData.test_date,
                            start_time: formData.start_time,
                            end_time: formData.end_time,
                            department_id: formData.department_id || deptId,
                            session_id: selectedSession,
                            class_id: formData.class_id,
                            subject_id: formData.subject_id
                        }
                    });
                    const theoryIds = [];
                    const labIds = [];
                    response.data.forEach(t => {
                        const desig = (t.designation || '').toLowerCase();
                        const isLabFaculty = desig.includes('lab assistant') || desig.includes('lab instructor') || desig.includes('lab incharge');
                        if (isLabFaculty) {
                            labIds.push(t);
                        } else {
                            theoryIds.push(t);
                        }
                    });
                    setAvailableTheoryInvigilators(theoryIds);
                    setAvailableLabInvigilators(labIds);
                } catch (err) {
                    console.error("Failed to fetch available invigilators", err);
                }
            } else {
                setAvailableTheoryInvigilators([]);
                setAvailableLabInvigilators([]);
            }
        };
        fetchAvailableInvigilators();
    }, [formData.test_date, formData.start_time, formData.end_time, formData.department_id, formData.class_id, formData.subject_id, deptId, selectedSession]);

    const handleSave = async (e, addAnother = false) => {
        if (e) e.preventDefault();

        if (addAnother) {
            if (!formData.subject_id || !formData.test_date || !formData.start_time || !formData.end_time) {
                toast.error("Please fill Subject, Date, and Time before adding another.");
                return;
            }
            const savedSubject = subjectOptions.find(s => String(s.id) === String(formData.subject_id));
            if (savedSubject) {
                const roomNames = formData.room_ids.map(id => {
                    const r = [...theoryRooms, ...labRooms].find(room => room.id === parseInt(id));
                    return r ? r.room_number : '';
                }).filter(Boolean).join(', ');
                setAddedSubjects(prev => [...prev, { 
                    ...savedSubject, 
                    test_date: formData.test_date, 
                    start_time: formData.start_time, 
                    end_time: formData.end_time, 
                    rooms: roomNames,
                    room_ids: formData.room_ids,
                    theory_invigilator_ids: formData.theory_invigilator_ids,
                    lab_invigilator_ids: formData.lab_invigilator_ids
                }]);
            }
            setFormData({
                ...formData,
                subject_id: '',
                room_ids: [],
                theory_invigilator_ids: [],
                lab_invigilator_ids: [],
                test_date: '',
                start_time: '',
                end_time: '',
            });
            return;
        }

        // Save & Close Logic (NOT addAnother)
        let allSubjects = [...addedSubjects];
        if (formData.subject_id) {
            const savedSubject = subjectOptions.find(s => String(s.id) === String(formData.subject_id));
            if (savedSubject) {
                allSubjects.push({ 
                    ...savedSubject, 
                    test_date: formData.test_date, 
                    start_time: formData.start_time, 
                    end_time: formData.end_time,
                    room_ids: formData.room_ids,
                    theory_invigilator_ids: formData.theory_invigilator_ids,
                    lab_invigilator_ids: formData.lab_invigilator_ids
                });
            }
        }

        if (allSubjects.length === 0) {
            toast.error("Please select at least one subject before saving.");
            return;
        }

        if (!formData.class_ids || formData.class_ids.length === 0) {
            toast.error("Please select a class.");
            return;
        }

        if (!isEditMode) {
            const result1 = await Swal.fire({
                title: 'Save & Close?',
                text: "Are you sure you want to save these subjects and close the window?",
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes, proceed',
                cancelButtonText: 'Cancel'
            });
            if (!result1.isConfirmed) return;
        }

        try {
            const subject_ids = allSubjects.map(s => s.id).join(',');
            const subject_timings = {};
            let mergedRoomIds = new Set();
            let mergedInvigilators = new Set();
            
            allSubjects.forEach(s => {
                subject_timings[s.id] = { 
                    test_date: s.test_date, 
                    start_time: s.start_time, 
                    end_time: s.end_time,
                    room_ids: s.room_ids || [],
                    theory_invigilator_ids: s.theory_invigilator_ids || [],
                    lab_invigilator_ids: s.lab_invigilator_ids || []
                };
                (s.room_ids || []).forEach(r => mergedRoomIds.add(r));
                (s.theory_invigilator_ids || []).forEach(r => mergedInvigilators.add(r));
                (s.lab_invigilator_ids || []).forEach(r => mergedInvigilators.add(r));
            });

            const payload = {
                ...formData,
                class_ids: Array.isArray(formData.class_ids) ? formData.class_ids.join(',') : formData.class_ids,
                section_ids: formData.section_ids.join(','),
                room_ids: Array.from(mergedRoomIds).join(','),
                invigilator_ids: Array.from(mergedInvigilators).join(','),
                subject_id: allSubjects[0].id,
                subject_ids: subject_ids,
                subject_timings: JSON.stringify(subject_timings),
                test_date: allSubjects[0].test_date,
                start_time: allSubjects[0].start_time,
                end_time: allSubjects[0].end_time,
            };
            
            if (!payload.test_name) payload.test_name = payload.test_type;

            if (isEditMode) {
                await api.put(`/internal-tests/${formData.id}`, payload);
                // Clean up merged duplicates if any
                if (formData._extra_ids_to_delete && formData._extra_ids_to_delete.length > 0) {
                    await Promise.all(formData._extra_ids_to_delete.map(id => api.delete(`/internal-tests/${id}`).catch(()=>{})));
                }
                toast.success('Test Updated!');
            } else {
                await api.post('/internal-tests', payload);
                toast.success('Test Scheduled!');
            }
            
            setModalOpen(false);
            fetchTests(selectedSession);
        } catch (error) {
            Swal.fire({
                title: 'Error Saving Test',
                text: error.response?.data?.message || 'Error scheduling test',
                icon: 'error',
                confirmButtonText: 'Okay'
            });
        }
    };

    const handleEdit = (test) => {
        setIsEditMode(true);
        const invigIds = test.invigilator_ids ? test.invigilator_ids.split(',').map(Number) : [];
        const theoryIds = [];
        const labIds = [];

        invigIds.forEach(id => {
            const t = teachers.find(teacher => teacher.id === id);
            if (t) {
                const isLabFaculty = (t.designation || '').toLowerCase().includes('lab') || (t.designation || '').toLowerCase().includes('instructor') || (t.designation || '').toLowerCase().includes('associate');
                if (isLabFaculty) {
                    labIds.push(id);
                } else {
                    theoryIds.push(id);
                }
            }
        });

        const timings = (() => { try { return test.subject_timings ? JSON.parse(test.subject_timings) : {}; } catch { return {}; } })();
        const subjectsList = test.subject_ids
            ? test.subject_ids.split(',').filter(Boolean).map(sid => {
                const s = subjects.find(sub => sub.id === parseInt(sid));
                if (!s) return null;
                const t = timings[sid] || { test_date: test.test_date, start_time: test.start_time, end_time: test.end_time };
                return {
                    ...s,
                    label: `${s.subject_name} [${s.subject_type}] (${s.subject_code})`,
                    test_date: t.test_date,
                    start_time: t.start_time,
                    end_time: t.end_time,
                    room_ids: test.room_ids ? test.room_ids.split(',') : [],
                    theory_invigilator_ids: theoryIds,
                    lab_invigilator_ids: labIds,
                    rooms: ''
                };
            }).filter(Boolean)
            : [];
            
        setAddedSubjects(subjectsList);

        setFormData({
            id: test.id,
            department_id: test.department_id || '',
            session_id: test.session_id || selectedSession,
            block_name: test.block_name || '',
            room_ids: test.room_ids ? test.room_ids.split(',') : (test.room_id ? [test.room_id.toString()] : []),
            class_ids: test.class_ids ? test.class_ids.split(',') : (test.class_id ? [test.class_id.toString()] : []),
            section_ids: test.section_ids ? test.section_ids.split(',') : [],
            subject_id: '',
            theory_invigilator_ids: theoryIds,
            lab_invigilator_ids: labIds,
            test_type: test.test_type || 'Written Class Test',
            test_name: test.test_name || '',
            ref_id: test.ref_id || '',
            test_date: test.test_date ? test.test_date.substring(0, 10) : '',
            start_time: test.start_time ? test.start_time.substring(0, 5) : '',
            end_time: test.end_time ? test.end_time.substring(0, 5) : ''
        });
        setModalOpen(true);
    };

    const handleView = (test) => {
        setViewData(test);
        setViewModalOpen(true);
    };

    const handleDelete = async (idOrIds) => {
        const result = await Swal.fire({
            title: 'Delete this test?',
            text: "This will remove the test and free up the room.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#6b7280',
            confirmButtonText: 'Yes, delete it!'
        });

        if (result.isConfirmed) {
            try {
                const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
                await Promise.all(ids.map(id => api.delete(`/internal-tests/${id}`)));
                toast.success('Test deleted successfully');
                fetchTests(selectedSession);
            } catch (error) {
                toast.error('Failed to delete test');
            }
        }
    };

    const [page, setPage] = useState(1);

    // Pagination reset on filter change
    useEffect(() => {
        setPage(1);
    }, [filterDepartment, showHistory, selectedSession]);

    useEffect(() => {
        setAnalysisPage(1);
    }, [analysisDeptFilter]);

    const getDayOfWeek = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return days[date.getDay()];
    };

    const columns = [
        { header: '#', accessor: (row, i) => (page - 1) * 20 + i + 1 },
        { header: 'Test Type', accessor: (row) => row.test_type + (row.ref_id ? ` (Ref: ${row.ref_id})` : '') },
        {
            header: 'Class', accessor: (row) => {
                let className = row.class_name || '-';
                if (row.section_ids) {
                    const sIds = row.section_ids.split(',').map(Number);
                    const sectionNames = sIds.map(id => sections.find(s => s.id === id)?.section_name).filter(Boolean);
                    if (sectionNames.length > 0) {
                        className += ` (Sec: ${sectionNames.join(', ')})`;
                    }
                }
                return className;
            }
        },
        {
            header: 'Dept', accessor: (row) => {
                const d = departments.find(dep => dep.id === row.department_id);
                return d ? (d.short_code || d.name) : '-';
            }
        },
        {
            header: 'Date & Day',
            accessor: (row) => `${new Date(row.test_date).toLocaleDateString('en-GB')} (${getDayOfWeek(row.test_date)})`
        },
        {
            header: 'Time',
            accessor: (row) => `${row.start_time.substring(0, 5)} - ${row.end_time.substring(0, 5)}`
        },
        {
            header: 'Room',
            accessor: (row) => {
                if (row.room_ids) {
                    const ids = row.room_ids.split(',').map(Number);
                    const selectedRooms = ids.map(id => rooms.find(r => r.id === id)).filter(Boolean);
                    if (selectedRooms.length > 0) {
                        return selectedRooms.map(r => `${r.building} - ${r.room_number}`).join(', ');
                    }
                }
                const r = rooms.find(room => room.id === row.room_id);
                return r ? `${r.building} - ${r.room_number}` : '-';
            }
        },
        {
            header: 'Invigilator(s)',
            accessor: (row) => {
                if (!row.invigilator_ids) return '-';
                const ids = row.invigilator_ids.split(',').map(Number);
                const invigs = ids.map(id => teachers.find(t => t.id === id)).filter(Boolean);

                return (
                    <div className="d-flex flex-wrap gap-1">
                        {invigs.map(invig => {
                            const isLab = (invig.designation || '').toLowerCase().includes('lab') || (invig.designation || '').toLowerCase().includes('instructor') || (invig.designation || '').toLowerCase().includes('associate');
                            return (
                                <span key={invig.id} className={`badge ${isLab ? 'bg-danger' : 'bg-primary'}`}>
                                    {invig.short_name || invig.full_name}
                                </span>
                            );
                        })}
                    </div>
                );
            }
        },
        {
            header: 'Actions',
            accessor: (row) => (
                <div className="d-flex gap-1 align-items-center">
                    <button className="btn btn-sm btn-outline-primary" onClick={() => handleView(row)} title="View">
                        <i className="bi bi-eye"></i>
                    </button>
                    <button className="btn btn-sm btn-outline-info" onClick={() => {
                        const timings = (() => { try { return row.subject_timings ? JSON.parse(row.subject_timings) : {}; } catch { return {}; } })();
                        const subjectsList = row.subject_ids
                            ? row.subject_ids.split(',').filter(Boolean).map(sid => {
                                const s = subjects.find(sub => sub.id === parseInt(sid));
                                if (!s) return null;
                                const t = timings[sid] || { test_date: row.test_date, start_time: row.start_time, end_time: row.end_time };
                                return { id: s.id, name: s.full_name, code: s.subject_code || '', test_date: t.test_date, start_time: t.start_time, end_time: t.end_time };
                            }).filter(Boolean)
                            : [{ id: row.subject_id, name: row.subject_name, code: row.subject_code, test_date: row.test_date, start_time: row.start_time, end_time: row.end_time }];
                        const reportData = buildReportData({ ...row, subjects_list: subjectsList }, rooms, teachers, sections);
                        openReportWindow(reportData, false);
                    }} title="Print Notice">
                        <i className="bi bi-printer"></i>
                    </button>
                    <button className="btn btn-sm btn-outline-danger" onClick={() => {
                        const timings = (() => { try { return row.subject_timings ? JSON.parse(row.subject_timings) : {}; } catch { return {}; } })();
                        const subjectsList = row.subject_ids
                            ? row.subject_ids.split(',').filter(Boolean).map(sid => {
                                const s = subjects.find(sub => sub.id === parseInt(sid));
                                if (!s) return null;
                                const t = timings[sid] || { test_date: row.test_date, start_time: row.start_time, end_time: row.end_time };
                                return { id: s.id, name: s.full_name, code: s.subject_code || '', test_date: t.test_date, start_time: t.start_time, end_time: t.end_time };
                            }).filter(Boolean)
                            : [{ id: row.subject_id, name: row.subject_name, code: row.subject_code, test_date: row.test_date, start_time: row.start_time, end_time: row.end_time }];
                        const reportData = buildReportData({ ...row, subjects_list: subjectsList }, rooms, teachers, sections);
                        openReportWindow(reportData, true);
                    }} title="Download PDF">
                        <i className="bi bi-file-earmark-pdf"></i>
                    </button>
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => handleEdit(row)} title="Edit">
                        <i className="bi bi-pencil"></i>
                    </button>
                    <button className="btn btn-sm btn-outline-danger" onClick={() => handleDelete(row._grouped_ids || row.id)} title="Delete">
                        <i className="bi bi-trash"></i>
                    </button>
                </div>
            )
        }
    ];

    if (showHistory) {
        columns.splice(4, 0, {
            header: 'Session',
            accessor: (row) => {
                const s = sessions.find(session => session.id === row.session_id);
                return s ? s.name : '-';
            }
        });
    }

    // Filter Logic
    let currentDeptId = parseInt(formData.department_id || deptId || 0);
    if (!currentDeptId && formData.class_id) {
        const selectedClass = classes.find(c => c.id.toString() === formData.class_id.toString());
        if (selectedClass) {
            currentDeptId = selectedClass.department_id;
        }
    }
    const filteredClasses = classes.filter(c =>
        c.is_active === 1 &&
        c.session_id === parseInt(selectedSession || 0) &&
        (currentDeptId ? c.department_id === currentDeptId : true)
    );

    const currentClassId = formData.class_id;
    const filteredSubjectsRaw = subjects.filter(s => {
        if (currentClassId) {
            const selectedClass = classes.find(c => c.id.toString() === currentClassId.toString());
            if (selectedClass) {
                const matchesClass = s.semester === selectedClass.semester && s.program_name === selectedClass.program_name;
                if (matchesClass) {
                    return s.department_id === currentDeptId;
                }
            }
            return false;
        }
        return s.department_id === currentDeptId;
    });

    // Removed deduplication logic so that Theory and Lab rows of the same subject code are both shown
    // Invigilator counts
    const invigilatorCounts = {};
    tests.forEach(test => {
        if (test.invigilator_ids) {
            test.invigilator_ids.split(',').forEach(id => {
                invigilatorCounts[id] = (invigilatorCounts[id] || 0) + 1;
            });
        }
    });

    const sortInvigilators = (a, b) => {
        const countA = invigilatorCounts[a.id] || 0;
        const countB = invigilatorCounts[b.id] || 0;
        return countA - countB;
    };

    const subjectOptions = filteredSubjectsRaw.map(s => {
        let label = s.full_name;
        if (s.subject_type === 'lab' || parseFloat(s.p_credit) > 0) {
            label += ' (Lab)';
        } else if (s.subject_type === 'theory' || parseFloat(s.l_credit) > 0 || parseFloat(s.t_credit) > 0) {
            label += ' (Theory)';
        }
        label += ` (${s.subject_code || s.short_code})`;
        return { id: s.id, label };
    });

    const isOnlineTest = formData.test_type === 'Online Class Test' || formData.test_type === 'Online Class Retest';
    const cseDeptObj = departments.find(d => d.name.toLowerCase().includes('computer science') || d.short_code?.toUpperCase() === 'CSE' || d.short_code?.toUpperCase() === 'CSAE');
    const globalCseDeptId = cseDeptObj ? cseDeptObj.id : null;
    const blocks = [...new Set(rooms.map(r => r.building).filter(Boolean))].sort();

    const labRooms = rooms.filter(r => {
        if (r.room_type !== 'lab') return false;
        if (formData.block_name && r.building !== formData.block_name) return false;
        if (isOnlineTest) {
            return (!globalCseDeptId || r.department_id == globalCseDeptId || !r.department_id);
        } else {
            return (!currentDeptId || r.department_id == currentDeptId || !r.department_id);
        }
    });

    const theoryRooms = rooms.filter(r => {
        if (r.room_type !== 'theory' && r.room_type !== 'hall') return false;
        if (formData.block_name && r.building !== formData.block_name) return false;
        if (!isOnlineTest) {
            return (!currentDeptId || r.department_id == currentDeptId || !r.department_id);
        }
        return false;
    });

    const activeSession = sessions.find(s => s.id === parseInt(selectedSession));
    let displayTests = tests;
    if (filterDepartment) {
        displayTests = displayTests.filter(t => t.department_id === parseInt(filterDepartment));
    }

    displayTests = displayTests.filter(t => {
        const testEndDateTime = new Date(`${t.test_date.substring(0, 10)}T${t.end_time}`);
        const isPast = testEndDateTime < new Date();
        return showHistory ? isPast : !isPast;
    });

    // Sorting
    displayTests.sort((a, b) => {
        const dateA = new Date(`${a.test_date.substring(0, 10)}T${a.start_time}`);
        const dateB = new Date(`${b.test_date.substring(0, 10)}T${b.start_time}`);
        if (showHistory) {
            return dateB - dateA; // Newest completed first (reverse chronological)
        } else {
            return dateA - dateB; // Closest upcoming first (chronological)
        }
    });

    // Pagination
    const totalPages = Math.ceil(displayTests.length / 20);
    const paginatedTests = displayTests.slice((page - 1) * 20, page * 20);

    return (
        <div className="page-container">
            <PageHeader
                title="Internal Tests & Exams"
                subtitle="Manage mid-terms, labs, and online tests, assign rooms & invigilators"
                actionButton={{
                    label: "Schedule New Test",
                    icon: "bi-plus-lg",
                    onClick: handleOpenModal
                }}
                rightContent={
                    <button className="btn btn-outline-info rounded-pill shadow-sm me-2" onClick={() => setAnalysisModalOpen(true)}>
                        <i className="bi bi-graph-up me-1"></i> Analyze Untested
                    </button>
                }
            />

            <div className="d-flex justify-content-between align-items-center mb-4 mt-2">
                <h5 className="mb-0">Session Overview: <span className="text-info fw-bold">{activeSession ? activeSession.name : '...'} (Active)</span></h5>
                <div>
                    <button
                        className={`btn ${showHistory ? 'btn-secondary' : 'btn-outline-secondary'}`}
                        onClick={() => setShowHistory(!showHistory)}
                    >
                        <i className="bi bi-clock-history me-2"></i>
                        {showHistory ? 'Back to Upcoming' : 'View History'}
                    </button>
                </div>
            </div>

            <div className="row mb-4">
                <div className="col-6 col-md-4 mb-3 mb-md-0">
                    <div className="card border-0 bg-primary-subtle text-primary shadow-sm h-100 p-3">
                        <div className="d-flex align-items-center">
                            <div className="bg-primary text-white rounded p-3 me-3">
                                <i className="bi bi-journal-text fs-3"></i>
                            </div>
                            <div>
                                <h3 className="fw-bold mb-0">{tests.length}</h3>
                                <p className="mb-0 text-muted">Total Tests</p>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="col-6 col-md-4 mb-3 mb-md-0">
                    <div className="card border-0 bg-warning-subtle text-warning shadow-sm h-100 p-3">
                        <div className="d-flex align-items-center">
                            <div className="bg-warning text-dark rounded p-3 me-3">
                                <i className="bi bi-clock-history fs-3"></i>
                            </div>
                            <div>
                                <h3 className="fw-bold mb-0">{tests.filter(t => new Date(`${t.test_date.substring(0, 10)}T${t.end_time}`) >= new Date()).length}</h3>
                                <p className="mb-0 text-muted">Upcoming</p>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="col-6 col-md-4 mb-3 mb-md-0">
                    <div className="card border-0 bg-success-subtle text-success shadow-sm h-100 p-3">
                        <div className="d-flex align-items-center">
                            <div className="bg-success text-white rounded p-3 me-3">
                                <i className="bi bi-check-circle fs-3"></i>
                            </div>
                            <div>
                                <h3 className="fw-bold mb-0">{tests.filter(t => new Date(`${t.test_date.substring(0, 10)}T${t.end_time}`) < new Date()).length}</h3>
                                <p className="mb-0 text-muted">Completed</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="card-header bg-white border-bottom pb-0 pt-3">
                    <div className="row align-items-center mb-3">
                        <div className="col-md-4">
                            <h5 className="mb-0">{showHistory ? 'Completed Tests History' : 'Upcoming Tests'}</h5>
                        </div>
                        <div className="col-md-4 offset-md-4">
                            {!isDepartmentAdmin && (
                                <select
                                    className="form-select form-select-sm"
                                    value={filterDepartment}
                                    onChange={(e) => setFilterDepartment(e.target.value)}
                                >
                                    <option value="">All Departments</option>
                                    {departments.map(d => (
                                        <option key={d.id} value={d.id}>{d.name}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                    </div>
                </div>
                <DataTable
                    columns={columns}
                    data={paginatedTests}
                    loading={loading}
                    emptyMessage={showHistory ? "No past tests found." : "No upcoming internal tests scheduled."}
                    searchable={true}
                    exportable={true}
                    exportFilename="Internal_Tests_Report"
                    page={page}
                    totalPages={totalPages}
                    totalRows={displayTests.length}
                    setPage={setPage}
                    rowClassName={(row) => {
                        const testEndDateTime = new Date(`${row.test_date.substring(0, 10)}T${row.end_time}`);
                        const isPast = testEndDateTime < new Date();
                        const isNew = new Date(row.created_at || row.updated_at || Date.now()) > new Date(Date.now() - 3600000);
                        if (isPast) return 'table-secondary'; // or table-success if you prefer
                        if (isNew && !showHistory) return 'table-primary';
                        return 'table-light';
                    }}
                />
            </div>

            <FormModal
                show={modalOpen}
                onClose={() => setModalOpen(false)}
                title={isEditMode ? 'Edit Internal Test' : 'Schedule Internal Test'}
                size="xl"
                hideFooter={true}
            >
                <div className="container-fluid p-0">
                    {/* SECTION 1: General Details */}
                    <div className="card mb-4 border-0 shadow-sm">
                        <div className="card-header bg-light border-bottom-0 pt-3 pb-2">
                            <h6 className="mb-0 text-primary"><i className="bi bi-info-circle me-2"></i>1. General Details</h6>
                        </div>
                        <div className="card-body bg-light rounded-bottom">
                            <div className="row g-3">
                                {!isDepartmentAdmin && (
                                    <div className="col-md-4">
                                        <label className="form-label fw-semibold text-muted small">Department <span className="text-danger">*</span></label>
                                        <select
                                            className="form-select form-select-sm"
                                            value={formData.department_id}
                                            onChange={(e) => setFormData({ ...formData, department_id: e.target.value, class_ids: [], subject_id: '' })}
                                        >
                                            <option value="">Select Department...</option>
                                            {departments.map(d => (
                                                <option key={d.id} value={d.id}>{d.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                <div className={isDepartmentAdmin ? "col-md-4" : "col-md-4"}>
                                    <label className="form-label fw-semibold text-muted small">Test Type <span className="text-danger">*</span></label>
                                    <select
                                        className="form-select form-select-sm"
                                        value={formData.test_type}
                                        onChange={(e) => setFormData({ ...formData, test_type: e.target.value, room_id: (e.target.value === 'Online Class Test' || e.target.value === 'Online Class Retest') ? '' : formData.room_id })}
                                        required
                                    >
                                        <option value="">Select Type...</option>
                                        <option value="Written Class Test">Written Class Test</option>
                                        <option value="Online Class Test">Online Class Test</option>
                                        <option value="Online Class Retest">Online Class Retest</option>
                                    </select>
                                </div>

                                <div className={isDepartmentAdmin ? "col-md-8" : "col-md-4"}>
                                    <label className="form-label fw-semibold text-muted small">Custom Name (Optional)</label>
                                    <input
                                        type="text"
                                        className="form-control form-control-sm"
                                        placeholder="e.g. Mid Term 1"
                                        value={formData.test_name}
                                        onChange={(e) => setFormData({ ...formData, test_name: e.target.value })}
                                    />
                                </div>

                                {isOnlineTest && (
                                    <div className="col-md-12">
                                        <label className="form-label fw-semibold text-muted small">Reference ID <span className="text-danger">*</span></label>
                                        <input
                                            type="text"
                                            className="form-control form-control-sm"
                                            placeholder="e.g. Ref. AKSU/CS/2026/EXAM/001"
                                            value={formData.ref_id}
                                            onChange={(e) => setFormData({ ...formData, ref_id: e.target.value })}
                                            required={isOnlineTest}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* SECTION 2: Class Details */}
                    <div className="card mb-4 border-0 shadow-sm">
                        <div className="card-header bg-light border-bottom-0 pt-3 pb-2">
                            <h6 className="mb-0 text-success"><i className="bi bi-people me-2"></i>2. Class Details</h6>
                        </div>
                        <div className="card-body bg-light rounded-bottom">
                            <div className="row g-3">
                                {currentDeptId > 0 && (
                                    <div className="col-md-5">
                                        <label className="form-label fw-semibold text-muted small">Class <span className="text-danger">*</span></label>
                                        <select
                                            className="form-select form-select-sm"
                                            multiple
                                            style={{ minHeight: '80px' }}
                                            value={formData.class_ids || []}
                                            onChange={(e) => {
                                                const selected = Array.from(e.target.selectedOptions, option => option.value);
                                                setFormData({ ...formData, class_ids: selected, section_ids: [], subject_id: '' });
                                            }}
                                            required
                                        >
                                            <option value="">Select Class...</option>
                                            {filteredClasses.map(c => (
                                                <option key={c.id} value={c.id}>{c.semester} {c.program_name} (Strength: {c.total_strength || 0})</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {(formData.class_ids || []).length > 0 && sections.filter(s => (formData.class_ids || []).includes(s.class_id.toString())).length > 1 && (
                                    <div className="col-md-4">
                                        <label className="form-label fw-semibold text-muted small">Sections</label>
                                        <select
                                            className="form-select form-select-sm"
                                            multiple
                                            style={{ minHeight: '60px' }}
                                            value={formData.section_ids || []}
                                            onChange={(e) => {
                                                const selected = Array.from(e.target.selectedOptions, option => option.value);
                                                setFormData({ ...formData, section_ids: selected });
                                            }}
                                        >
                                            {sections.filter(s => (formData.class_ids || []).includes(s.class_id.toString())).map(s => (
                                                <option key={s.id} value={s.id}>Sec {s.section_name} ({s.student_strength})</option>
                                            ))}
                                        </select>
                                        <small className="text-muted" style={{fontSize: '11px'}}>Hold Ctrl to select multiple.</small>
                                    </div>
                                )}

                                <div className={(formData.class_ids || []).length > 0 && sections.filter(s => (formData.class_ids || []).includes(s.class_id.toString())).length > 1 ? "col-md-3" : "col-md-7"}>
                                    <label className="form-label fw-semibold text-muted small">Reg. Students <span className="text-danger">*</span></label>
                                    <input
                                        type="number"
                                        className="form-control form-control-sm"
                                        placeholder="No. of students"
                                        value={formData.registered_students}
                                        onChange={(e) => setFormData({ ...formData, registered_students: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* SECTION 3: Subject & Schedule */}
                    <div className="card mb-3 border-primary shadow-sm" style={{ backgroundColor: '#f8fbff' }}>
                        <div className="card-header bg-primary text-white pt-3 pb-2 d-flex justify-content-between align-items-center">
                            <h6 className="mb-0"><i className="bi bi-journal-bookmark me-2"></i>3. Subject & Schedule (Add Subject)</h6>
                            {addedSubjects.length > 0 && (
                                <span className="badge bg-light text-primary">{addedSubjects.length} Added</span>
                            )}
                        </div>
                        <div className="card-body">
                            {addedSubjects.length > 0 && (
                                <div className="mb-3 p-2 bg-success bg-opacity-10 rounded border border-success border-opacity-25">
                                    <h6 className="text-success small fw-bold mb-2">Recently Added Subjects:</h6>
                                    <ul className="mb-0 small ps-3">
                                        {addedSubjects.map((s, idx) => (
                                            <li key={idx} className="text-success mb-1 d-flex align-items-center justify-content-between border-bottom pb-1">
                                                <div>
                                                    <strong>{s.label}</strong>
                                                    <span className="ms-2 badge bg-success bg-opacity-25 text-success border border-success border-opacity-50">
                                                        <i className="bi bi-calendar3 me-1"></i>{s.test_date} | <i className="bi bi-clock me-1"></i>{s.start_time} - {s.end_time} | <i className="bi bi-geo-alt me-1"></i>{s.rooms || 'N/A'}
                                                    </span>
                                                </div>
                                                <button type="button" className="btn btn-sm btn-link text-danger p-0" onClick={() => setAddedSubjects(prev => prev.filter((_, i) => i !== idx))}>
                                                    <i className="bi bi-x-circle-fill"></i>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <div className="row g-3">
                                <div className="col-md-12">
                                    <label className="form-label fw-semibold text-primary small">Subject <span className="text-danger">*</span></label>
                                    <select
                                        className="form-select form-select-lg shadow-sm border-primary"
                                        value={formData.subject_id}
                                        onChange={(e) => setFormData({ ...formData, subject_id: e.target.value })}
                                        required
                                        style={{ fontSize: '15px' }}
                                    >
                                        <option value="">Select Subject...</option>
                                        {subjectOptions.filter(opt => !addedSubjects.some(a => String(a.id) === String(opt.id))).map(opt => (
                                            <option key={opt.id} value={opt.id}>{opt.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="col-md-4">
                                    <label className="form-label fw-semibold text-muted small">Date <span className="text-danger">*</span></label>
                                    <input type="date" className="form-control form-control-sm" 
                                        value={formData.test_date} 
                                        onChange={(e) => setFormData({ ...formData, test_date: e.target.value })} required />
                                </div>
                                <div className="col-md-4">
                                    <label className="form-label fw-semibold text-muted small">Start Time <span className="text-danger">*</span></label>
                                    <input type="time" className="form-control form-control-sm" 
                                        value={formData.start_time} 
                                        onChange={(e) => setFormData({ ...formData, start_time: e.target.value })} required />
                                </div>
                                <div className="col-md-4">
                                    <label className="form-label fw-semibold text-muted small">End Time <span className="text-danger">*</span></label>
                                    <input type="time" className="form-control form-control-sm" 
                                        value={formData.end_time} 
                                        onChange={(e) => setFormData({ ...formData, end_time: e.target.value })} required />
                                </div>

                                <div className="col-md-12">
                                    <label className="form-label fw-semibold text-muted small d-flex justify-content-between">
                                        <span>Rooms / Labs <span className="text-danger">*</span></span>
                                        {formData.room_ids?.length > 0 && (
                                            <span className="badge bg-info text-dark">
                                                Capacity: {formData.room_ids.reduce((sum, id) => {
                                                    const room = [...theoryRooms, ...labRooms].find(r => r.id === parseInt(id));
                                                    return sum + (room ? room.capacity : 0);
                                                }, 0)} / Students: {formData.registered_students || 0}
                                            </span>
                                        )}
                                    </label>
                                    <select
                                        className="form-select form-select-sm"
                                        multiple
                                        style={{ minHeight: '120px' }}
                                        value={formData.room_ids || []}
                                        onChange={(e) => {
                                            const selected = Array.from(e.target.selectedOptions, option => option.value);
                                            setFormData({ ...formData, room_ids: selected });
                                        }}
                                        required
                                    >
                                        {!isOnlineTest && (
                                            <optgroup label="Theory Rooms" style={{ color: '#28a745' }}>
                                                {theoryRooms.map(r => (
                                                    <option style={{ color: 'black' }} key={r.id} value={r.id}>{r.room_number} ({r.capacity} seats) - {r.building}</option>
                                                ))}
                                            </optgroup>
                                        )}
                                        <optgroup label="Labs" style={{ color: '#0056b3' }}>
                                            {labRooms.map(r => (
                                                <option style={{ color: 'black' }} key={r.id} value={r.id}>{r.room_number} ({r.capacity} seats) - {r.building}</option>
                                            ))}
                                        </optgroup>
                                    </select>
                                    <small className="text-muted" style={{fontSize: '11px'}}>Hold Ctrl to select multiple.</small>
                                </div>

                                <div className="col-md-6">
                                    <label className="form-label fw-semibold text-muted small">Theory Invigilators <span className="text-danger">*</span></label>
                                    <select
                                        className="form-select form-select-sm"
                                        multiple
                                        style={{ minHeight: '140px' }}
                                        value={formData.theory_invigilator_ids}
                                        onChange={(e) => {
                                            const selected = Array.from(e.target.selectedOptions, option => option.value);
                                            setFormData({ ...formData, theory_invigilator_ids: selected });
                                        }}
                                    >
                                        {[...availableTheoryInvigilators].sort((a, b) => {
                                            if (a.is_allocated && !b.is_allocated) return -1;
                                            if (!a.is_allocated && b.is_allocated) return 1;
                                            return sortInvigilators(a, b);
                                        }).map(t => (
                                            <option 
                                                key={t.id} 
                                                value={t.id} 
                                                style={t.is_allocated ? { backgroundColor: '#e6ffe6', color: '#006600', fontWeight: 'bold' } : {}}
                                            >
                                                {t.is_allocated ? '★ ' : ''}{t.full_name} ({t.designation || 'Faculty'})
                                            </option>
                                        ))}
                                    </select>
                                    <small className="text-muted" style={{fontSize: '11px'}}>{formData.test_date && formData.start_time ? "Showing free faculties" : "Select date & time to load"}</small>
                                </div>

                                <div className="col-md-6">
                                    <label className="form-label fw-semibold text-muted small">Lab Invigilators <span className="text-danger">*</span></label>
                                    <select
                                        className="form-select form-select-sm"
                                        multiple
                                        style={{ minHeight: '140px' }}
                                        value={formData.lab_invigilator_ids}
                                        onChange={(e) => {
                                            const selected = Array.from(e.target.selectedOptions, option => option.value);
                                            setFormData({ ...formData, lab_invigilator_ids: selected });
                                        }}
                                    >
                                        {[...availableLabInvigilators].sort(sortInvigilators).map(t => (
                                            <option key={t.id} value={t.id}>{t.full_name} ({t.designation || 'Faculty'})</option>
                                        ))}
                                    </select>
                                    <small className="text-muted" style={{fontSize: '11px'}}>{formData.test_date && formData.start_time ? "Showing free faculties" : "Select date & time to load"}</small>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="modal-footer mt-4 pb-0 px-0" style={{ borderTop: '1px solid var(--app-border)' }}>
                        <button type="button" className="btn btn-secondary mt-3" onClick={() => setModalOpen(false)}>Cancel</button>
                        <button type="button" className="btn btn-outline-primary mt-3 px-4 shadow-sm" onClick={(e) => handleSave(e, true)}>
                            <i className="bi bi-plus-circle me-2"></i> {isEditMode ? 'Update & Add Another' : 'Save & Add Another'}
                        </button>
                        <button type="button" className="btn btn-primary mt-3 px-4 shadow-sm" onClick={(e) => handleSave(e, false)}>
                            <i className="bi bi-check-lg me-2"></i> {isEditMode ? 'Update & Close' : 'Save & Close'}
                        </button>
                    </div>
                </div>
            </FormModal>

            <FormModal
                show={viewModalOpen}
                onClose={() => setViewModalOpen(false)}
                title="View Internal Test Details"
                hideFooter={true}
                size="md"
            >
                {viewData && (
                    <div className="p-2">
                        <h4 className="text-primary mb-3">{viewData.test_name} ({viewData.test_type})</h4>

                        <div className="row mb-3">
                            <div className="col-sm-4 text-muted">Reference ID</div>
                            <div className="col-sm-8 fw-bold">{viewData.ref_id || 'N/A'}</div>
                        </div>

                        <div className="row mb-3">
                            <div className="col-sm-4 text-muted">Department</div>
                            <div className="col-sm-8 fw-bold">{viewData.department_name || 'N/A'}</div>
                        </div>

                        <div className="row mb-3">
                            <div className="col-sm-4 text-muted">Class &amp; Subject</div>
                            <div className="col-sm-8 fw-bold">
                                <div>{viewData.class_name || 'N/A'} {viewData.section_ids ? `(Sec: ${viewData.section_ids.split(',').map(id => sections.find(s => s.id === parseInt(id))?.section_name).filter(Boolean).join(', ')})` : ''}</div>
                                {viewData.subject_ids ? (
                                    viewData.subject_ids.split(',').filter(Boolean).map((sid, i) => {
                                        const s = subjects.find(sub => sub.id === parseInt(sid));
                                        return s ? <div key={i}><i className="bi bi-book me-1 text-primary"></i>{s.full_name} <small className="text-muted">({s.subject_code})</small></div> : null;
                                    })
                                ) : (
                                    <div>{viewData.subject_name} ({viewData.subject_code})</div>
                                )}
                            </div>
                        </div>

                        <div className="row mb-3">
                            <div className="col-sm-4 text-muted">Schedule</div>
                            <div className="col-sm-8 fw-bold">
                                <div><i className="bi bi-calendar3 me-2"></i>{new Date(viewData.test_date).toLocaleDateString('en-GB')} ({getDayOfWeek(viewData.test_date)})</div>
                                <div><i className="bi bi-clock me-2"></i>{viewData.start_time?.substring(0, 5)} - {viewData.end_time?.substring(0, 5)}</div>
                            </div>
                        </div>

                        <div className="row mb-3">
                            <div className="col-sm-4 text-muted">Location</div>
                            <div className="col-sm-8 fw-bold">
                                <i className="bi bi-geo-alt me-2"></i>
                                {viewData.room_ids ? (
                                    viewData.room_ids.split(',').map(id => rooms.find(r => r.id === parseInt(id))).filter(Boolean).map(r => `${r.building} (${r.room_type}) - ${r.room_number}`).join(', ')
                                ) : (
                                    `${viewData.block_name} (${viewData.room_type}) - ${viewData.room_number}`
                                )}
                            </div>
                        </div>

                        <div className="row">
                            <div className="col-sm-4 text-muted">Invigilators</div>
                            <div className="col-sm-8">
                                {viewData.invigilator_ids ? (
                                    <div className="d-flex flex-wrap gap-1">
                                        {viewData.invigilator_ids.split(',').filter(Boolean).map((id, i) => {
                                            const teacher = teachers.find(t => t.id === parseInt(id));
                                            if (!teacher) return null;
                                            // Determine badge color based on whether they are theory or lab (approximate by looking at timings if possible, or just blue)
                                            // We'll just show them as badges
                                            return (
                                                <span key={i} className="badge bg-primary text-white p-1 px-2 rounded-1" title={teacher.full_name}>
                                                    {teacher.short_name || teacher.full_name}
                                                </span>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <span className="text-muted">None assigned</span>
                                )}
                            </div>
                        </div>

                        <div className="mt-4 pt-3 border-top d-flex justify-content-end gap-2">
                            <button type="button" className="btn btn-outline-primary" onClick={() => {
                                setViewModalOpen(false);
                                const timings = (() => { try { return viewData.subject_timings ? JSON.parse(viewData.subject_timings) : {}; } catch { return {}; } })();
                                const subjectsList = viewData.subject_ids
                                    ? viewData.subject_ids.split(',').filter(Boolean).map(sid => {
                                        const s = subjects.find(sub => sub.id === parseInt(sid));
                                        if (!s) return null;
                                        const t = timings[sid] || { test_date: viewData.test_date, start_time: viewData.start_time, end_time: viewData.end_time };
                                        return { id: s.id, name: s.full_name, code: s.subject_code || '', test_date: t.test_date, start_time: t.start_time, end_time: t.end_time };
                                    }).filter(Boolean)
                                    : [{ id: viewData.subject_id, name: viewData.subject_name, code: viewData.subject_code, test_date: viewData.test_date, start_time: viewData.start_time, end_time: viewData.end_time }];
                                const reportData = buildReportData({ ...viewData, subjects_list: subjectsList }, rooms, teachers, sections);
                                openReportWindow(reportData, false);
                            }}>
                                <i className="bi bi-printer me-2"></i>Print Notice
                            </button>
                            <button type="button" className="btn btn-danger" onClick={() => {
                                setViewModalOpen(false);
                                const timings = (() => { try { return viewData.subject_timings ? JSON.parse(viewData.subject_timings) : {}; } catch { return {}; } })();
                                const subjectsList = viewData.subject_ids
                                    ? viewData.subject_ids.split(',').filter(Boolean).map(sid => {
                                        const s = subjects.find(sub => sub.id === parseInt(sid));
                                        if (!s) return null;
                                        const t = timings[sid] || { test_date: viewData.test_date, start_time: viewData.start_time, end_time: viewData.end_time };
                                        return { id: s.id, name: s.full_name, code: s.subject_code || '', test_date: t.test_date, start_time: t.start_time, end_time: t.end_time };
                                    }).filter(Boolean)
                                    : [{ id: viewData.subject_id, name: viewData.subject_name, code: viewData.subject_code, test_date: viewData.test_date, start_time: viewData.start_time, end_time: viewData.end_time }];
                                const reportData = buildReportData({ ...viewData, subjects_list: subjectsList }, rooms, teachers, sections);
                                openReportWindow(reportData, true);
                            }}>
                                <i className="bi bi-file-earmark-pdf me-2"></i>Download PDF
                            </button>
                        </div>
                    </div>
                )}
            </FormModal>
            <FormModal
                show={analysisModalOpen}
                onClose={() => setAnalysisModalOpen(false)}
                title="Gap Analysis: Untested Subjects"
                hideFooter={true}
                size="xl"
            >
                <div className="p-2">
                    <div className="d-flex justify-content-between align-items-center mb-4">
                        <p className="text-muted mb-0">This list shows subjects that do not have any internal tests scheduled in the current active session.</p>
                        {!isDepartmentAdmin && (
                            <select
                                className="form-select form-select-sm w-auto"
                                value={analysisDeptFilter}
                                onChange={(e) => setAnalysisDeptFilter(e.target.value)}
                            >
                                <option value="">All Departments</option>
                                {departments.map(d => (
                                    <option key={d.id} value={d.id}>{d.name}</option>
                                ))}
                            </select>
                        )}
                    </div>

                    {(() => {
                        const testedSubjectIds = new Set();
                        tests.forEach(t => {
                            if (t.subject_ids) {
                                t.subject_ids.split(',').filter(Boolean).forEach(id => testedSubjectIds.add(parseInt(id)));
                            } else if (t.subject_id) {
                                testedSubjectIds.add(parseInt(t.subject_id));
                            }
                        });

                        let untested = subjects.filter(s => !testedSubjectIds.has(s.id));

                        if (isDepartmentAdmin) {
                            untested = untested.filter(s => s.department_id === deptId || s.department_id === null);
                        } else if (analysisDeptFilter) {
                            untested = untested.filter(s => s.department_id === parseInt(analysisDeptFilter));
                        }

                        // Sort by department, then class
                        untested.sort((a, b) => {
                            const deptA = departments.find(d => d.id === a.department_id)?.name || '';
                            const deptB = departments.find(d => d.id === b.department_id)?.name || '';
                            if (deptA !== deptB) return deptA.localeCompare(deptB);
                            const classA = `${a.semester} ${a.program_name}`;
                            const classB = `${b.semester} ${b.program_name}`;
                            return classA.localeCompare(classB);
                        });

                        const analysisColumns = [
                            { header: '#', accessor: (row, i) => (analysisPage - 1) * 20 + i + 1 },
                            {
                                header: 'Department', accessor: (row) => {
                                    const d = departments.find(dep => dep.id === row.department_id);
                                    return d ? (d.short_code || d.name) : '-';
                                }
                            },
                            { header: 'Class', accessor: (row) => `${row.semester} ${row.program_name}` },
                            { header: 'Subject Code', accessor: (row) => <span className="badge bg-secondary">{row.subject_code || row.short_code}</span> },
                            { header: 'Subject Name', accessor: (row) => row.full_name }
                        ];

                        const totalPages = Math.ceil(untested.length / 20);
                        const paginatedUntested = untested.slice((analysisPage - 1) * 20, analysisPage * 20);

                        return (
                            <DataTable
                                columns={analysisColumns}
                                data={paginatedUntested}
                                loading={loading}
                                emptyMessage="All subjects have tests scheduled!"
                                searchable={true}
                                exportable={true}
                                exportFilename="Untested_Subjects_Report"
                                page={analysisPage}
                                totalPages={totalPages}
                                totalRows={untested.length}
                                setPage={setAnalysisPage}
                            />
                        );
                    })()}
                </div>
            </FormModal>

        </div>
    );
};

export default InternalTests;
