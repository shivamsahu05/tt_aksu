import React, { useState, useEffect, useRef } from 'react';
import api from '../../utils/api';
import { toast } from 'react-toastify';
import { safeDelete, showSuccess } from '../../utils/alerts';
import FormModal from '../../components/common/FormModal';
import PageHeader from '../../components/common/PageHeader';
import DataTable from '../../components/common/DataTable';
import StatusBadge from '../../components/common/StatusBadge';
import ActionButtons from '../../components/common/ActionButtons';
import { useForm } from 'react-hook-form';
import Swal from 'sweetalert2';
import { useAuth } from '../../context/AuthContext';
import * as XLSX from 'xlsx';
import { exportToExcel } from '../../utils/exportToExcel';

const Subjects = () => {
    const { user } = useAuth();
    const isDeptAdmin = user?.role === 'DEPARTMENT_ADMIN';
    const [subjects, setSubjects] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [loading, setLoading] = useState(true);

    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [deptFilter, setDeptFilter] = useState('');
    const [sessionFilter, setSessionFilter] = useState('all');
    const [classFilter, setClassFilter] = useState('');
    const [typeFilter, setTypeFilter] = useState('');

    // Classes for Course Dropdown
    const [classes, setClasses] = useState([]);
    const [allSections, setAllSections] = useState([]);
    const [sessions, setSessions] = useState([]);

    // Pagination
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [editItem, setEditItem] = useState(null);

    // Bulk Upload
    const [showBulkUpload, setShowBulkUpload] = useState(false);
    const [bulkFile, setBulkFile] = useState(null);
    const [bulkErrors, setBulkErrors] = useState(null);
    const [bulkSuccess, setBulkSuccess] = useState(null);

    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deleteDeptFilter, setDeleteDeptFilter] = useState('');
    const [deleteClassFilter, setDeleteClassFilter] = useState('');
    const [selectedSubjects, setSelectedSubjects] = useState([]);

    // Stats overview
    const [subjectStats, setSubjectStats] = useState({ data: [], totals: null });
    const [showOverviewModal, setShowOverviewModal] = useState(false);
    const [overviewDetails, setOverviewDetails] = useState({ departmentStats: [], nptelSubjects: [] });
    const [overviewLoading, setOverviewLoading] = useState(false);
    const [overviewActiveTab, setOverviewActiveTab] = useState('stats');
    const [modalSubjects, setModalSubjects] = useState([]);

    const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm();
    const subjectType = watch('subject_type');
    const watchL = watch('l_credit');
    const watchP = watch('p_credit');
    const watchProgramName = watch('program_name');
    const watchSemester = watch('semester');
    const watchDeptId = watch('department_id');

    const prevSubjectTypeRef = useRef(null);

    useEffect(() => {
        if (!showModal) return;
        if (subjectType === 'theory') {
            setValue('nptel_mode', 'THEORY');
        } else if (subjectType === 'lab') {
            setValue('nptel_mode', 'LAB');
        }
        if (prevSubjectTypeRef.current !== subjectType && prevSubjectTypeRef.current !== null) {
            prevSubjectTypeRef.current = subjectType;
            if (subjectType === 'lab') {
                setValue('l_credit', 0);
                setValue('p_credit', 1);
                setValue('total_credits', 1);
                setValue('nptel_mode', 'LAB');
            } else if (subjectType === 'theory') {
                setValue('l_credit', 3);
                setValue('p_credit', 0);
                setValue('total_credits', 3);
                setValue('nptel_mode', 'THEORY');
            } else if (subjectType === 'both') {
                setValue('l_credit', 3);
                setValue('p_credit', 1);
                setValue('total_credits', 4);
                setValue('nptel_mode', 'BOTH');
            }
        }
    }, [subjectType, showModal, setValue]);

    useEffect(() => {
        if (!showModal) return;
        const l = parseFloat(watchL || 0);
        const p = parseFloat(watchP || 0);
        if (!isNaN(l) && !isNaN(p)) {
            setValue('total_credits', l + p);
        }
    }, [watchL, watchP, showModal, setValue]);

    useEffect(() => {
        if (!editItem && watchProgramName && watchSemester && showModal) {
            const filteredSections = allSections.filter(sec =>
                (!watchDeptId || sec.department_id === Number(watchDeptId)) &&
                (sec.program_name === watchProgramName) &&
                (sec.semester === Number(watchSemester))
            );
            if (filteredSections.length > 1) {
                // Pre-check all sections by default so the user can uncheck the ones they don't want
                setValue('sections', filteredSections.map(s => String(s.id)));
            } else {
                setValue('sections', []);
            }
        }
    }, [watchProgramName, watchSemester, watchDeptId, allSections, editItem, setValue, showModal]);

    const fetchSessions = async () => {
        try {
            const res = await api.get('/sessions?limit=100');
            if (res.data.success) {
                setSessions(res.data.data);
                const active = res.data.data.find(s => s.is_active === 1);
                if (active) setSessionFilter(active.id);
            }
        } catch (error) {
            console.error('Failed to fetch sessions');
        }
    };

    const fetchSubjectStats = async () => {
        try {
            let url = '/subjects/stats';
            if (sessionFilter && sessionFilter !== 'all') {
                const selectedSession = sessions.find(s => s.id === Number(sessionFilter));
                if (selectedSession) {
                    url += `?session_id=${sessionFilter}`;
                    const name = selectedSession.name.toLowerCase();
                    if (name.includes('jul') || name.includes('aug') || name.includes('odd')) {
                        url += '&semester_type=odd';
                    } else if (name.includes('jan') || name.includes('feb') || name.includes('even')) {
                        url += '&semester_type=even';
                    }
                }
            } else {
                url += '?_t=' + Date.now(); // cache buster
            }
            const res = await api.get(url);
            if (res.data.success) {
                setSubjectStats({ data: res.data.data, totals: res.data.totals });
            }
        } catch (error) {
            console.error('Failed to fetch stats');
        }
    };

    const fetchModalSubjects = async (tab) => {
        try {
            setOverviewLoading(true);
            let url = '/subjects?limit=1000&is_active_for_session=1';
            if (sessionFilter && sessionFilter !== 'all') {
                const selectedSession = sessions.find(s => s.id === Number(sessionFilter));
                if (selectedSession) {
                    url += `&session_id=${sessionFilter}`;
                    const name = selectedSession.name.toLowerCase();
                    if (name.includes('jul') || name.includes('aug') || name.includes('odd')) {
                        url += '&semester_type=odd';
                    } else if (name.includes('jan') || name.includes('feb') || name.includes('even')) {
                        url += '&semester_type=even';
                    }
                }
            }
            if (tab === 'theory') url += '&subject_type=theory';
            if (tab === 'lab') url += '&subject_type=lab';
            if (tab === 'nptel') url += '&is_nptel=1';
            if (tab === 'allocated') url += '&allocation_status=allocated';
            if (tab === 'unallocated') url += '&allocation_status=unallocated';

            const res = await api.get(url);
            if (res.data.success) {
                setModalSubjects(res.data.data);
            }
        } catch (error) {
            console.error('Failed to fetch modal subjects');
            toast.error('Failed to load subject details');
        } finally {
            setOverviewLoading(false);
        }
    };

    const handleCardClick = (tab) => {
        setOverviewActiveTab(tab);
        setShowOverviewModal(true);
        if (tab === 'stats') {
            fetchOverviewDetails();
        } else {
            fetchModalSubjects(tab);
        }
    };

    const fetchOverviewDetails = async () => {
        try {
            setOverviewLoading(true);
            let url = '/subjects/overview-details';
            if (sessionFilter && sessionFilter !== 'all') {
                const selectedSession = sessions.find(s => s.id === Number(sessionFilter));
                if (selectedSession) {
                    url += `?session_id=${sessionFilter}`;
                    const name = selectedSession.name.toLowerCase();
                    if (name.includes('jul') || name.includes('aug') || name.includes('odd')) {
                        url += '&semester_type=odd';
                    } else if (name.includes('jan') || name.includes('feb') || name.includes('even')) {
                        url += '&semester_type=even';
                    }
                }
            } else {
                url += '?_t=' + Date.now();
            }
            const res = await api.get(url);
            if (res.data.success) {
                setOverviewDetails(res.data.data);
            }
        } catch (error) {
            toast.error('Failed to fetch overview details');
        } finally {
            setOverviewLoading(false);
        }
    };

    const fetchDepartments = async () => {
        try {
            const res = await api.get('/departments?limit=100'); // Get all departments for dropdown
            if (res.data.success) {
                setDepartments(res.data.data);
            }
        } catch (error) {
            console.error('Failed to fetch departments');
        }
    };

    const fetchClasses = async () => {
        try {
            const res = await api.get('/classes?limit=1000');
            if (res.data.success) {
                setClasses(res.data.data);
            }
        } catch (error) {
            console.error('Failed to fetch classes');
        }
    };

    const fetchAllSections = async () => {
        try {
            const res = await api.get('/classes/all-sections');
            if (res.data.success) {
                setAllSections(res.data.data);
            }
        } catch (error) {
            console.error('Failed to fetch sections');
        }
    };

    const fetchSubjects = async () => {
        try {
            setLoading(true);
            let url = `/subjects?page=${page}&limit=10&search=${searchTerm}`;
            if (deptFilter) url += `&department_id=${deptFilter}`;
            if (typeFilter) url += `&subject_type=${typeFilter}`;
            if (classFilter) {
                try {
                    const parsed = JSON.parse(classFilter);
                    if (parsed.program_name) url += `&program_name=${encodeURIComponent(parsed.program_name)}`;
                    if (parsed.semester) url += `&semester=${parsed.semester}`;
                } catch (e) { }
            } else if (sessionFilter && sessionFilter !== 'all') {
                const selectedSession = sessions.find(s => s.id === Number(sessionFilter));
                if (selectedSession) {
                    const name = selectedSession.name.toLowerCase();
                    if (name.includes('jul') || name.includes('aug') || name.includes('odd')) {
                        url += '&semester_type=odd';
                    } else if (name.includes('jan') || name.includes('feb') || name.includes('even')) {
                        url += '&semester_type=even';
                    }
                }
            }

            const res = await api.get(url);
            if (res.data.success) {
                setSubjects(res.data.data);
                setTotalPages(res.data.pagination.totalPages || res.data.pagination.pages || 1);
                setSelectedSubjects([]);
            }
        } catch (error) {
            toast.error('Failed to fetch subjects');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSessions();
        fetchDepartments();
        fetchClasses();
        fetchAllSections();
    }, []);

    useEffect(() => {
        if (sessions.length > 0 || sessionFilter === 'all') {
            fetchSubjectStats();
        }
    }, [sessionFilter, sessions.length]);

    useEffect(() => {
        fetchSubjects();
    }, [page, searchTerm, deptFilter, classFilter, sessionFilter, typeFilter]);

    const handleSearch = (e) => {
        setSearchTerm(e.target.value);
        setPage(1);
    };

    const handleDeptFilter = (e) => {
        setDeptFilter(e.target.value);
        setClassFilter(''); // Reset class when dept changes
        setPage(1);
    };

    const handleClassFilter = (e) => {
        setClassFilter(e.target.value);
        setPage(1);
    };

    const handleSessionFilter = (e) => {
        setSessionFilter(e.target.value);
        setClassFilter(''); // Reset class when session changes
        setPage(1);
    };

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            const allIds = subjects.map(s => s.id);
            setSelectedSubjects(Array.from(new Set([...selectedSubjects, ...allIds])));
        } else {
            const currentIds = new Set(subjects.map(s => s.id));
            setSelectedSubjects(selectedSubjects.filter(id => !currentIds.has(id)));
        }
    };

    const handleSelectOne = (id) => {
        if (selectedSubjects.includes(id)) {
            setSelectedSubjects(selectedSubjects.filter(item => item !== id));
        } else {
            setSelectedSubjects([...selectedSubjects, id]);
        }
    };

    const handleBulkDeleteSelected = () => {
        if (selectedSubjects.length === 0) return;
        Swal.fire({
            title: `Delete ${selectedSubjects.length} selected subject(s)?`,
            text: "This action cannot be undone!",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc3545',
            cancelButtonColor: '#6c757d',
            confirmButtonText: '<i class="bi bi-trash"></i> Yes, delete selected!'
        }).then(async (finalResult) => {
            if (finalResult.isConfirmed) {
                try {
                    const res = await api.post('/subjects/bulk-delete', { ids: selectedSubjects });
                    if (res.data.success) {
                        showSuccess(res.data.message);
                        setSelectedSubjects([]);
                        fetchSubjects();
                        fetchSubjectStats();
                    }
                } catch (error) {
                    toast.error(error.response?.data?.message || 'Failed to delete selected subjects');
                }
            }
        });
    };

    const handleDeleteByDepartment = () => {
        setDeleteDeptFilter('');
        setDeleteClassFilter('');
        setShowDeleteModal(true);
    };

    const confirmDeleteByDepartment = async () => {
        if (!deleteDeptFilter) {
            toast.error('You need to select a department');
            return;
        }

        const deptId = deleteDeptFilter === 'all' ? null : parseInt(deleteDeptFilter);
        const deptName = deleteDeptFilter === 'all' ? 'All Departments' : departments.find(d => d.id === deptId)?.name;

        let classObj = null;
        if (deleteClassFilter) {
            try { classObj = JSON.parse(deleteClassFilter); } catch (e) { }
        }
        const classDesc = classObj ? ` (${classObj.program_name} - Semester ${classObj.semester})` : '';

        Swal.fire({
            title: `Delete subjects for ${deptName}${classDesc}?`,
            text: "This action cannot be undone!",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc3545',
            cancelButtonColor: '#6c757d',
            confirmButtonText: '<i class="bi bi-trash"></i> Yes, delete them!'
        }).then(async (finalResult) => {
            if (finalResult.isConfirmed) {
                try {
                    const payload = {
                        department_ids: deptId ? [deptId] : departments.map(d => d.id),
                        ...(classObj ? { program_name: classObj.program_name, semester: classObj.semester } : {})
                    };
                    const res = await api.post('/subjects/bulk-delete-by-department', payload);
                    if (res.data.success) {
                        showSuccess(res.data.message);
                        fetchSubjects();
                        fetchSubjectStats();
                        setShowDeleteModal(false);
                    }
                } catch (error) {
                    toast.error(error.response?.data?.message || 'Failed to delete subjects');
                }
            }
        });
    };

    const handleClearNptel = () => {
        Swal.fire({
            title: 'Clear NPTEL / MOOC Status?',
            text: 'Are you sure you want to clear NPTEL / Swayam status from all subjects? This is step 1 of 2.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: '<i class="bi bi-arrow-right-circle"></i> Yes, continue...'
        }).then((firstResult) => {
            if (firstResult.isConfirmed) {
                Swal.fire({
                    title: 'Final Confirmation Required!',
                    text: 'Please confirm again: This will reset all NPTEL/MOOC subjects back to regular subjects. You can enable NPTEL again manually anytime.',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#d33',
                    cancelButtonColor: '#6c757d',
                    confirmButtonText: '<i class="bi bi-check-circle-fill"></i> Confirm & Clear All NPTEL'
                }).then(async (secondResult) => {
                    if (secondResult.isConfirmed) {
                        try {
                            const payload = isDeptAdmin ? { department_id: user.department_id } : {};
                            const res = await api.post('/subjects/clear-nptel', payload);
                            if (res.data.success) {
                                showSuccess(res.data.message);
                                fetchSubjects();
                                fetchSubjectStats();
                            }
                        } catch (error) {
                            toast.error(error.response?.data?.message || 'Failed to clear NPTEL subjects');
                        }
                    }
                });
            }
        });
    };

    const classOptions = [];
    const seen = new Set();
    classes.filter(c => c.session_id === Number(sessionFilter) && (!deptFilter || c.department_id === Number(deptFilter))).forEach(c => {
        const key = `${c.semester}-${c.program_name}`;
        if (!seen.has(key)) {
            seen.add(key);
            classOptions.push({ semester: c.semester, program_name: c.program_name });
        }
    });
    classOptions.sort((a, b) => a.semester - b.semester || a.program_name.localeCompare(b.program_name));

    const availableProgramsForForm = [...new Set(classes.filter(c => !watchDeptId || c.department_id === Number(watchDeptId)).map(c => c.program_name).filter(Boolean))].sort();

    const openAddModal = () => {
        setEditItem(null);
        prevSubjectTypeRef.current = 'theory';
        reset({
            department_id: isDeptAdmin ? user.department_id : '',
            program_name: '',
            full_name: '',
            short_code: '',
            subject_code: '',
            subject_type: 'theory',
            total_credits: 3.0,
            l_credit: 3,
            t_credit: 0,
            p_credit: 0,
            semester: '',
            is_active: true,
            is_elective: false,
            is_nptel: false,
            nptel_mode: 'BOTH',
            sections: []
        });
        setShowModal(true);
    };

    const openEditModal = (subject) => {
        setEditItem(subject);
        prevSubjectTypeRef.current = subject.subject_type;
        reset({
            department_id: subject.department_id,
            program_name: subject.program_name || '',
            full_name: subject.full_name,
            short_code: subject.short_code,
            subject_code: subject.subject_code || '',
            subject_type: subject.subject_type,
            total_credits: subject.total_credits,
            l_credit: subject.l_credit,
            t_credit: subject.t_credit,
            p_credit: subject.p_credit,
            semester: subject.semester || '',
            is_active: subject.is_active === 1,
            is_elective: subject.is_elective === 1,
            is_nptel: subject.is_nptel === 1,
            nptel_mode: subject.nptel_mode || 'BOTH',
            sections: subject.section_ids ? subject.section_ids.split(',').map(Number) : []
        });
        setShowModal(true);
    };

    const handleDownloadTemplate = () => {
        const headers = ["Sr", "Subject Name", "Short Name", "Subject Code", "Department Code", "Course", "Type (theory/lab/both)", "Total Credits", "L", "T", "P", "Semester", "Is Elective"];
        const data = [
            [1, "Data Structures", "DS", "CS201", "CSE", "BTech CSE", "theory", 3, 3, 0, 0, 3, "No"],
            [2, "Operating Systems", "OS", "CS301", "CSE", "BTech CSE", "theory + lab", 4, 3, 0, 1, 5, "No"]
        ];

        const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

        // Set column widths
        ws['!cols'] = [
            { wch: 5 },  // Sr
            { wch: 30 }, // Subject Name
            { wch: 15 }, // Short Name
            { wch: 15 }, // Subject Code
            { wch: 25 }, // Department
            { wch: 15 }, // Course
            { wch: 22 }, // Type
            { wch: 15 }, // Total Credits
            { wch: 8 },  // L
            { wch: 8 },  // T
            { wch: 8 },  // P
            { wch: 10 }, // Semester
            { wch: 12 }  // Is Elective
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Subjects");
        XLSX.writeFile(wb, "subject_upload_template.csv");
    };

    const handleBulkUpload = async (e) => {
        e.preventDefault();
        if (!bulkFile) {
            toast.error("Please select a file to upload");
            return;
        }
        const formData = new FormData();
        formData.append('file', bulkFile);

        try {
            setBulkErrors(null);
            setBulkSuccess(null);
            const res = await api.post('/subjects/bulk', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            if (res.data.success) {
                setBulkSuccess(res.data.message);
                if (res.data.errors) {
                    setBulkErrors(res.data.errors);
                }
                fetchSubjects();
                fetchSubjectStats();
            }
        } catch (error) {
            toast.error(error.response?.data?.message || "Failed to upload file");
        }
    };

    const onSubmit = async (data) => {
        try {
            const payload = {
                ...data,
                total_credits: parseFloat(data.total_credits),
                l_credit: parseFloat(data.l_credit || 0),
                t_credit: parseFloat(data.t_credit || 0),
                p_credit: parseFloat(data.p_credit || 0),
                semester: data.semester ? parseInt(data.semester) : null,
                is_active: data.is_active ? 1 : 0,
                sections: data.sections || []
            };

            if (editItem) {
                await api.put(`/subjects/${editItem.id}`, payload);
                showSuccess('Subject updated successfully');
            } else {
                await api.post('/subjects', payload);
                showSuccess('Subject added successfully');
            }
            setShowModal(false);
            fetchSubjects();
            fetchSubjectStats();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Operation failed');
        }
    };

    const handleDelete = (id, name) => {
        safeDelete(name, async () => {
            try {
                await api.delete(`/subjects/${id}`);
                showSuccess('Subject deleted successfully');
                fetchSubjects();
                fetchSubjectStats();
            } catch (error) {
                toast.error(error.response?.data?.message || 'Failed to delete subject');
            }
        });
    };



    const isAllSelected = subjects.length > 0 && subjects.every(s => selectedSubjects.includes(s.id));
    const isSomeSelected = subjects.some(s => selectedSubjects.includes(s.id));

    const columns = [
        {
            label: (
                <input
                    type="checkbox"
                    className="form-check-input"
                    checked={isAllSelected}
                    ref={input => { if (input) input.indeterminate = !isAllSelected && isSomeSelected; }}
                    onChange={handleSelectAll}
                    title="Select All on Page"
                />
            ),
            className: 'text-center',
            headerStyle: { width: '45px' }
        },
        { label: '#', className: 'text-center text-muted fw-semibold', headerStyle: { width: '50px' } },
        { label: 'Subject Info' },
        { label: 'Department' },
        { label: 'Course & Sem' },
        { label: 'Type' },
        { label: 'Credits & Load' },
        { label: 'Status' },
        { label: 'Actions', className: 'text-end pe-4' }
    ];

    return (
        <div>
            <PageHeader
                title="Subjects"
                subtitle="Manage course subjects and curricula"
                icon="bi-book"
                rightContent={
                    <div className="d-flex flex-column align-items-start align-items-md-end gap-2 w-100">
                        {/* Top Row: Session */}
                        <div className="d-flex w-100 justify-content-start justify-content-md-end">
                            <select className="form-select form-select-sm bg-white rounded-pill border px-3 shadow-sm w-auto" style={{ minWidth: '150px', fontWeight: '600', color: 'var(--text-primary)' }} value={sessionFilter} onChange={handleSessionFilter}>
                                <option value="all">All Sessions</option>
                                {sessions.map(session => (
                                    <option key={session.id} value={session.id}>{session.name} {session.is_active === 1 ? '(Active)' : ''}</option>
                                ))}
                            </select>
                        </div>

                    </div>
                }
            />

            {/* ── Subject Stats Overview ── */}
            {subjectStats.totals && (
                <div style={{ marginBottom: '24px' }}>
                    <style>{`
                        .stat-card-custom {
                            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
                            cursor: pointer;
                        }
                        .stat-card-custom:hover {
                            transform: translateY(-5px);
                            box-shadow: 0 14px 28px -10px rgba(0, 0, 0, 0.2) !important;
                            background: var(--app-surface-hover, #f1f5f9) !important;
                            border-color: var(--bs-primary) !important;
                        }
                        .stat-card-custom:hover .icon-box {
                            transform: scale(1.1);
                        }
                        [data-theme='dark'] .stat-card-custom:hover {
                            background: #1e293b !important;
                            border-color: #334155 !important;
                        }
                    `}</style>
                    {/* Grand total summary strip */}
                    <div
                        className="row g-3 mb-4"
                    >
                        {[{
                            id: 'stats', icon: 'bi-book-half', label: 'Total Subjects',
                            value: subjectStats.totals.absolute_total || subjectStats.totals.total,
                            colorClass: 'primary'
                        }, {
                            id: 'theory', icon: 'bi-easel2-fill', label: 'Theory',
                            value: subjectStats.totals.theory,
                            colorClass: 'info'
                        }, {
                            id: 'lab', icon: 'bi-pc-display', label: 'Lab',
                            value: subjectStats.totals.lab,
                            colorClass: 'success'
                        }, {
                            id: 'allocated', icon: 'bi-check-circle-fill', label: 'Allocated',
                            value: subjectStats.totals.allocated,
                            colorClass: 'success'
                        }, {
                            id: 'unallocated', icon: 'bi-hourglass-split', label: 'Unallocated',
                            value: subjectStats.totals.unallocated,
                            colorClass: subjectStats.totals.unallocated > 0 ? 'warning' : 'secondary'
                        }, {
                            id: 'nptel', icon: 'bi-laptop', label: 'NPTEL / SWAYAM',
                            value: subjectStats.totals.nptel_count || 0,
                            subtext: `L: ${subjectStats.totals.nptel_theory || 0} | P: ${subjectStats.totals.nptel_lab || 0} | Both: ${subjectStats.totals.nptel_both || 0}`,
                            colorClass: 'danger'
                        }].map((stat, i) => (
                            <div key={i} className="col-12 col-sm-6 col-md-4 col-xl">
                                <div onClick={() => handleCardClick(stat.id)} className="card border-0 shadow-sm rounded-4 h-100 bg-white hover-lift transition-all stat-card-custom" style={{ cursor: 'pointer' }}>
                                    <div className="card-body p-3 d-flex align-items-center">
                                        <div className={`bg-${stat.colorClass} bg-opacity-10 rounded-circle p-2 d-flex align-items-center justify-content-center me-2 text-${stat.colorClass}`} style={{ width: '40px', height: '40px', flexShrink: 0 }}>
                                            <i className={`bi ${stat.icon} fs-5`}></i>
                                        </div>
                                        <div>
                                            <p className="mb-0 text-muted" style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 'bold' }}>{stat.label}</p>
                                            <div className="d-flex align-items-baseline gap-2">
                                                <h4 className="mb-0 fw-bold text-dark">{stat.value ?? <span style={{ opacity: 0.3 }}>—</span>}</h4>
                                                {stat.subtext && <small className={`text-${stat.colorClass} fw-semibold`} style={{ fontSize: '0.7rem' }}>{stat.subtext}</small>}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}

                    </div>

                    {/* Department-wise breakdown table card */}
                    {subjectStats.data.length > 1 && (
                        <div style={{
                            background: 'var(--app-surface, #fff)',
                            borderRadius: '16px',
                            boxShadow: '0 2px 12px rgba(0,0,0,0.07)',
                            overflow: 'hidden',
                            border: '1px solid var(--app-border, #e2e8f0)'
                        }}>
                            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--app-border, #e2e8f0)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <i className="bi bi-bar-chart-fill" style={{ color: '#6366f1' }}></i>
                                <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>Department-wise Breakdown</span>
                            </div>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                    <thead>
                                        <tr style={{ background: 'var(--app-surface-2, #f8fafc)' }}>
                                            {['Department', 'Total', 'Theory', 'Lab', 'NPTEL (Cr)', 'Allocated', 'Remaining', 'Progress'].map((h, i) => (
                                                <th key={i} style={{
                                                    padding: '10px 16px', textAlign: i === 0 ? 'left' : 'center',
                                                    fontWeight: 600, color: 'var(--text-secondary)', fontSize: '11px',
                                                    textTransform: 'uppercase', letterSpacing: '0.05em',
                                                    whiteSpace: 'nowrap'
                                                }}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {subjectStats.data.map((dept, idx) => {
                                            const pct = dept.total > 0 ? Math.round((dept.allocated / dept.total) * 100) : 0;
                                            return (
                                                <tr key={dept.dept_id} style={{
                                                    borderTop: '1px solid var(--app-border, #e2e8f0)',
                                                    background: idx % 2 === 0 ? 'transparent' : 'var(--app-surface-2, #f8fafc)'
                                                }}>
                                                    <td style={{ padding: '12px 16px', fontWeight: 600 }}>
                                                        <span style={{
                                                            background: '#6366f115',
                                                            color: '#6366f1',
                                                            borderRadius: '6px',
                                                            padding: '2px 8px',
                                                            fontSize: '11px',
                                                            fontWeight: 700,
                                                            marginRight: '8px'
                                                        }}>{dept.short_code}</span>
                                                        {dept.dept_name}
                                                    </td>
                                                    <td style={{ textAlign: 'center', padding: '12px 16px', fontWeight: 700 }}>{dept.total}</td>
                                                    <td style={{ textAlign: 'center', padding: '12px 16px' }}>
                                                        <span style={{ background: '#0ea5e915', color: '#0ea5e9', borderRadius: '20px', padding: '2px 10px', fontWeight: 600 }}>
                                                            {dept.theory}
                                                        </span>
                                                    </td>
                                                    <td style={{ textAlign: 'center', padding: '12px 16px' }}>
                                                        <span style={{ background: '#8b5cf615', color: '#8b5cf6', borderRadius: '20px', padding: '2px 10px', fontWeight: 600 }}>
                                                            {dept.lab}
                                                        </span>
                                                    </td>
                                                    <td style={{ textAlign: 'center', padding: '12px 16px' }}>
                                                        <span style={{ background: '#ec489915', color: '#ec4899', borderRadius: '20px', padding: '2px 10px', fontWeight: 600 }}>
                                                            {dept.nptel_count || 0} ({dept.nptel_credits || 0} Cr)
                                                        </span>
                                                    </td>
                                                    <td style={{ textAlign: 'center', padding: '12px 16px' }}>
                                                        <span style={{ background: '#10b98115', color: '#10b981', borderRadius: '20px', padding: '2px 10px', fontWeight: 600 }}>
                                                            {dept.allocated}
                                                        </span>
                                                    </td>
                                                    <td style={{ textAlign: 'center', padding: '12px 16px' }}>
                                                        <span style={{
                                                            background: dept.unallocated > 0 ? '#f59e0b15' : '#10b98115',
                                                            color: dept.unallocated > 0 ? '#f59e0b' : '#10b981',
                                                            borderRadius: '20px', padding: '2px 10px', fontWeight: 600
                                                        }}>
                                                            {dept.unallocated}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '12px 16px', minWidth: '120px' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <div style={{ flex: 1, height: '6px', background: '#e2e8f0', borderRadius: '99px', overflow: 'hidden' }}>
                                                                <div style={{
                                                                    width: `${pct}%`, height: '100%', borderRadius: '99px',
                                                                    background: pct === 100 ? '#10b981' : pct >= 50 ? '#6366f1' : '#f59e0b',
                                                                    transition: 'width 0.5s ease'
                                                                }} />
                                                            </div>
                                                            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', minWidth: '30px' }}>{pct}%</span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}


            <div className="card border-0 shadow-sm rounded-4">

                {/* Bottom Row: Actions */}
                <div className="d-flex flex-wrap gap-2 align-items-center justify-content-start justify-content-md-end mt-1">
                    {selectedSubjects.length > 0 && (
                        <button onClick={handleBulkDeleteSelected} className="btn btn-danger btn-sm rounded-pill px-3 shadow-sm text-nowrap animate__animated animate__fadeIn">
                            <i className="bi bi-trash-fill me-1"></i> Delete ({selectedSubjects.length})
                        </button>
                    )}
                    <button onClick={handleDeleteByDepartment} className="btn btn-outline-danger btn-sm rounded-pill px-3 shadow-sm text-nowrap">
                        <i className="bi bi-trash3 me-2"></i>
                        <span className="d-none d-sm-inline">Delete by Dept</span>
                        <span className="d-sm-none">Del Dept</span>
                    </button>
                    <button onClick={handleClearNptel} className="btn btn-outline-warning btn-sm rounded-pill px-3 shadow-sm text-nowrap" title="Clear NPTEL/Swayam flags from all subjects">
                        <i className="bi bi-arrow-counterclockwise me-2"></i>
                        <span className="d-none d-md-inline">Clear NPTEL / MOOC</span>
                        <span className="d-md-none">Clear NPTEL</span>
                    </button>
                    <button
                        onClick={() => exportToExcel({
                            filename: 'Subjects_Curriculum',
                            sheetName: 'Subjects',
                            columns: [
                                { header: 'Subject Code', key: 'subject_code' },
                                { header: 'Subject Name', key: 'subject_name' },
                                { header: 'Department', key: 'department_name' },
                                { header: 'Program', key: 'program_name' },
                                { header: 'Semester', key: 'semester' },
                                { header: 'Type', key: 'subject_type' },
                                { header: 'Total Credits', key: 'total_credits' },
                                { header: 'L Credit', key: 'l_credit' },
                                { header: 'T Credit', key: 't_credit' },
                                { header: 'P Credit', key: 'p_credit' },
                                { header: 'NPTEL/SWAYAM', key: row => row.is_nptel ? 'Yes' : 'No' },
                                { header: 'NPTEL Mode', key: 'nptel_mode' },
                                { header: 'Status', key: row => row.is_active ? 'Active' : 'Inactive' },
                            ],
                            data: subjects,
                            notes: [
                                '✅ Included: Code, Name, Department, Program, Semester, Type, Credits (L/T/P), NPTEL flag, Status',
                                '❌ Excluded: Section-level allocations, Teacher assignments, Internal notes',
                                'ℹ️ Tip: Apply session/dept filters before exporting to get targeted data.',
                            ],
                        })}
                        className="btn btn-outline-success btn-sm rounded-pill px-3 shadow-sm text-nowrap"
                    >
                        <i className="bi bi-file-earmark-excel me-2"></i>
                        <span className="d-none d-sm-inline">Export Excel</span>
                        <span className="d-sm-none">Export</span>
                    </button>
                    <button onClick={() => { setBulkFile(null); setBulkErrors(null); setBulkSuccess(null); setShowBulkUpload(true); }} className="btn btn-secondary btn-sm rounded-pill px-3 shadow-sm text-nowrap">
                        <i className="bi bi-cloud-upload me-2"></i>
                        <span className="d-none d-sm-inline">Bulk Upload</span>
                        <span className="d-sm-none">Upload</span>
                    </button>
                    <button onClick={openAddModal} className="btn btn-primary btn-sm rounded-pill px-3 shadow-sm text-nowrap">
                        <i className="bi bi-plus-lg me-2"></i> Add Subject
                    </button>
                </div>


                <div className="card-header border-bottom-0 py-3 d-flex flex-wrap justify-content-between align-items-center gap-3" style={{ background: 'var(--card-bg)' }}>
                    <div className="input-group w-auto flex-grow-1" style={{ maxWidth: '400px' }}>
                        <span className="input-group-text bg-light border-end-0 rounded-start-pill">
                            <i className="bi bi-search text-muted"></i>
                        </span>
                        <input
                            type="text"
                            className="form-control bg-light border-start-0 rounded-end-pill"
                            placeholder="Search by subject name or code..."
                            value={searchTerm}
                            onChange={handleSearch}
                        />
                    </div>
                    <div className="d-flex flex-wrap gap-2 justify-content-md-end">
                        <select className="form-select form-select-sm bg-light rounded-pill border-0 px-3 w-auto" value={deptFilter} onChange={handleDeptFilter}>
                            <option value="">All Departments</option>
                            {departments.map(dept => (
                                <option key={dept.id} value={dept.id}>{dept.name} ({dept.short_code})</option>
                            ))}
                        </select>
                        <select className="form-select form-select-sm bg-light rounded-pill border-0 px-3 w-auto" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
                            <option value="">All Types</option>
                            <option value="theory">Theory (Lecture)</option>
                            <option value="lab">Lab (Practical)</option>
                            <option value="both">Theory + Lab</option>
                        </select>
                        <select className="form-select form-select-sm bg-light rounded-pill border-0 px-3 w-auto" value={classFilter} onChange={handleClassFilter}>
                            <option value="">All Active Classes</option>
                            {classOptions.map((cls, idx) => (
                                <option key={idx} value={JSON.stringify(cls)}>Semester {cls.semester} - {cls.program_name}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <DataTable
                    columns={columns}
                    data={subjects}
                    loading={loading}
                    page={page}
                    totalPages={totalPages}
                    setPage={setPage}
                    emptyMessage="No subjects found."
                    emptyIcon="bi-journal-x"
                    renderRow={(sub, idx) => (
                        <tr key={sub.id} className={sub.is_nptel === 1 ? 'table-danger bg-danger bg-opacity-10' : (sub.is_elective === 1 ? 'table-warning bg-opacity-10' : '')} style={sub.is_nptel === 1 ? { borderLeft: '4px solid #e11d48', backgroundColor: '#fff1f2' } : {}}>
                            <td className="text-center align-middle" onClick={(e) => e.stopPropagation()}>
                                <input
                                    type="checkbox"
                                    className="form-check-input"
                                    checked={selectedSubjects.includes(sub.id)}
                                    onChange={() => handleSelectOne(sub.id)}
                                />
                            </td>
                            <td className="text-center align-middle text-muted small">
                                {(page - 1) * 10 + idx + 1}
                            </td>
                            <td>
                                <div className="d-flex align-items-center gap-2 flex-wrap">
                                    <span className="fw-bold text-dark">{sub.full_name}</span>
                                    {sub.is_nptel === 1 && (() => {
                                        const effectiveMode = sub.subject_type === 'theory' ? 'THEORY' : sub.subject_type === 'lab' ? 'LAB' : (sub.nptel_mode || 'BOTH').toUpperCase();
                                        return (
                                            <span className={`badge px-2 py-1 rounded-pill shadow-sm ${effectiveMode === 'THEORY' ? 'bg-primary text-white' : effectiveMode === 'LAB' ? 'bg-info text-white' : 'bg-danger text-white'}`} style={{ fontSize: '10px' }}>
                                                <i className="bi bi-laptop me-1"></i>
                                                NPTEL ({effectiveMode === 'THEORY' ? 'Lecture Only' : effectiveMode === 'LAB' ? 'Lab Only' : 'Both / Full'})
                                            </span>
                                        );
                                    })()}
                                </div>
                                <div className="small text-muted font-monospace">{sub.subject_code ? `${sub.subject_code} | ` : ''}{sub.short_code}</div>
                            </td>
                            <td>
                                <div className="fw-medium text-dark">{sub.department_code}</div>
                            </td>
                            <td>
                                <div className="fw-medium text-dark">{sub.program_name || 'All Courses'}</div>
                                <div className="small text-muted">{sub.semester ? `Semester ${sub.semester}` : 'All Semesters'}</div>
                            </td>
                            <td>
                                {sub.subject_type === 'theory' && <span className="badge bg-light text-dark border rounded-pill px-2">Theory (Lecture)</span>}
                                {sub.subject_type === 'lab' && <span className="badge bg-info bg-opacity-10 text-info border border-info border-opacity-25 rounded-pill px-2">Lab (Practical)</span>}
                                {sub.subject_type === 'both' && <span className="badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25 rounded-pill px-2">Theory + Lab</span>}
                                {sub.is_elective === 1 && <span className="badge bg-warning bg-opacity-10 text-warning border border-warning border-opacity-25 rounded-pill px-2 ms-1 mt-1 d-inline-block">Elective</span>}
                            </td>
                            <td>
                                <div className="fw-medium text-dark">{Number(sub.total_credits)} Credits</div>
                                <div className="small text-muted">L: {Number(sub.l_credit)} | T: {Number(sub.t_credit)} | P: {Number(sub.p_credit)}</div>
                            </td>
                            <td><StatusBadge active={sub.is_active} /></td>
                            <td className="pe-4">
                                <ActionButtons
                                    onEdit={() => openEditModal(sub)}
                                    onDelete={() => handleDelete(sub.id, sub.full_name)}
                                />
                            </td>
                        </tr>
                    )}
                />
            </div>

            <FormModal
                show={showModal}
                title={editItem ? "Edit Subject" : "Add Subject"}
                onClose={() => setShowModal(false)}
                onSubmit={handleSubmit(onSubmit)}
                isSubmitting={isSubmitting}
            >
                <div className="mb-3">
                    <label className="form-label fw-semibold small">Subject Name <span className="text-danger">*</span></label>
                    <input
                        type="text"
                        className={`form-control ${errors.full_name ? 'is-invalid' : ''}`}
                        placeholder="e.g., Data Structures and Algorithms"
                        {...register('full_name', { required: 'Subject name is required' })}
                        autoFocus
                    />
                    {errors.full_name && <div className="invalid-feedback">{errors.full_name.message}</div>}
                </div>

                <div className="row">
                    <div className="col-md-6 mb-3">
                        <label className="form-label fw-semibold small">Short Name <span className="text-danger">*</span></label>
                        <input
                            type="text"
                            className={`form-control ${errors.short_code ? 'is-invalid' : ''}`}
                            placeholder="e.g., DS"
                            {...register('short_code', { required: 'Short name is required' })}
                        />
                        {errors.short_code && <div className="invalid-feedback">{errors.short_code.message}</div>}
                    </div>
                    <div className="col-md-6 mb-3">
                        <label className="form-label fw-semibold small">Subject Code</label>
                        <input
                            type="text"
                            className={`form-control ${errors.subject_code ? 'is-invalid' : ''}`}
                            placeholder="e.g., CS-101"
                            {...register('subject_code')}
                        />
                        {errors.subject_code && <div className="invalid-feedback">{errors.subject_code.message}</div>}
                    </div>
                </div>

                {isDeptAdmin ? null : (
                    <div className="mb-3">
                        <label className="form-label fw-semibold small">Department <span className="text-danger">*</span></label>
                        <select
                            className={`form-select ${errors.department_id ? 'is-invalid' : ''}`}
                            {...register('department_id', { required: !isDeptAdmin ? 'Department is required' : false })}
                        >
                            <option value="">Select Department...</option>
                            {departments.map(dept => (
                                <option key={dept.id} value={dept.id}>{dept.name} ({dept.short_code})</option>
                            ))}
                        </select>
                        {errors.department_id && <div className="invalid-feedback">{errors.department_id.message}</div>}
                    </div>
                )}

                <div className="row">
                    <div className="col-md-6 mb-3">
                        <label className="form-label fw-semibold small">Course (Program)</label>
                        <select
                            className="form-select"
                            {...register('program_name')}
                        >
                            <option value="">Select Course...</option>
                            {availableProgramsForForm.length > 0 ? availableProgramsForForm.map(prog => (
                                <option key={prog} value={prog}>{prog}</option>
                            )) : (
                                <option value="" disabled>N/A (No courses found)</option>
                            )}
                        </select>
                    </div>
                    <div className="col-md-6 mb-3">
                        <label className="form-label fw-semibold small">Semester</label>
                        <select className="form-select" {...register('semester')}>
                            <option value="">Any / Elective</option>
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(s => (
                                <option key={s} value={s}>Semester {s}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {(() => {
                    const selectedProg = watch('program_name');
                    const selectedSem = watch('semester');

                    if (selectedProg && selectedSem) {
                        const filteredSections = allSections.filter(sec =>
                            (!watch('department_id') || sec.department_id === Number(watch('department_id'))) &&
                            (sec.program_name === selectedProg) &&
                            (sec.semester === Number(selectedSem))
                        );

                        if (filteredSections.length > 1) {
                            return (
                                <div className="mb-3">
                                    <label className="form-label fw-semibold small">Map to Sections</label>
                                    <div className="small text-muted mb-2">Select specific sections or leave all unchecked to map to all sections of this course.</div>
                                    <div className="d-flex flex-wrap gap-2">
                                        {filteredSections.map(sec => (
                                            <div key={sec.id} className="form-check form-check-inline border rounded px-2 py-1 bg-light m-0">
                                                <input
                                                    className="form-check-input ms-0 me-2 mt-1"
                                                    type="checkbox"
                                                    value={sec.id}
                                                    id={`sec_${sec.id}`}
                                                    {...register('sections')}
                                                />
                                                <label className="form-check-label small" htmlFor={`sec_${sec.id}`}>
                                                    {sec.section_name}
                                                </label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        }
                    }
                    return null;
                })()}

                <div className="row">
                    <div className="col-md-6 mb-3">
                        <label className="form-label fw-semibold small">Subject Type <span className="text-danger">*</span></label>
                        <select
                            className={`form-select ${errors.subject_type ? 'is-invalid' : ''}`}
                            {...register('subject_type', { required: 'Subject type is required' })}
                        >
                            <option value="theory">Theory Only</option>
                            <option value="lab">Lab / Practical Only</option>
                            <option value="both">Theory + Lab</option>
                        </select>
                        {errors.subject_type && <div className="invalid-feedback">{errors.subject_type.message}</div>}
                    </div>
                    <div className="col-md-6 mb-3">
                        <label className="form-label fw-semibold small">Credits <span className="text-danger">*</span></label>
                        <input
                            type="number"
                            step="0.5"
                            className={`form-control ${errors.total_credits ? 'is-invalid' : ''}`}
                            {...register('total_credits', {
                                required: 'Credits is required',
                                min: { value: 0, message: 'Minimum 0' },
                                validate: (value) => {
                                    const l = parseFloat(watch('l_credit') || 0);
                                    const p = parseFloat(watch('p_credit') || 0);
                                    if (parseFloat(value) > (l + p)) {
                                        return 'Credits cannot be greater than L + P. Tutorial (T) is not counted towards total credits.';
                                    }
                                    return true;
                                }
                            })}
                        />
                        {errors.total_credits && <div className="invalid-feedback">{errors.total_credits.message}</div>}
                    </div>
                </div>

                <div className="row bg-light rounded-3 p-3 mx-0 mb-3 border">
                    <div className="col-4">
                        <label className="form-label fw-semibold small mb-1">L (Lecture)</label>
                        <input
                            type="number" step="0.5"
                            className={`form-control form-control-sm ${errors.l_credit ? 'is-invalid' : ''}`}
                            readOnly={subjectType === 'lab'}
                            style={{ backgroundColor: subjectType === 'lab' ? '#e9ecef' : '' }}
                            {...register('l_credit', { min: { value: 0, message: 'Min 0' } })}
                        />
                    </div>
                    <div className="col-4 border-start">
                        <label className="form-label fw-semibold small mb-1">T (Tutorial)</label>
                        <input
                            type="number" step="0.5"
                            className={`form-control form-control-sm ${errors.t_credit ? 'is-invalid' : ''}`}
                            {...register('t_credit', { min: { value: 0, message: 'Min 0' } })}
                        />
                    </div>
                    <div className="col-4 border-start">
                        <label className="form-label fw-semibold small mb-1">P (Practical)</label>
                        <input
                            type="number" step="0.5"
                            className={`form-control form-control-sm ${errors.p_credit ? 'is-invalid' : ''}`}
                            readOnly={subjectType === 'theory'}
                            style={{ backgroundColor: subjectType === 'theory' ? '#e9ecef' : '' }}
                            {...register('p_credit', { min: { value: 0, message: 'Min 0' } })}
                        />
                    </div>
                    <div className="col-12 mt-2">
                        <div className="small text-muted fst-italic">Note: Tutorial (T) is not counted towards Total Credits.</div>
                    </div>
                </div>

                <div className="row mt-2">
                    <div className="col-6">
                        <div className="form-check form-switch">
                            <input
                                className="form-check-input"
                                type="checkbox"
                                id="isActiveSubjectSwitch"
                                {...register('is_active')}
                            />
                            <label className="form-check-label fw-semibold small" htmlFor="isActiveSubjectSwitch">Active Subject</label>
                        </div>
                    </div>
                    <div className="col-6">
                        <div className="form-check form-switch">
                            <input
                                className="form-check-input"
                                type="checkbox"
                                id="isElectiveSubjectSwitch"
                                {...register('is_elective')}
                            />
                            <label className="form-check-label fw-semibold small" htmlFor="isElectiveSubjectSwitch">Is Elective Subject</label>
                        </div>
                    </div>
                    <div className="col-12 mt-2">
                        <div className="form-check form-switch">
                            <input
                                className="form-check-input"
                                type="checkbox"
                                id="isNptelSubjectSwitch"
                                {...register('is_nptel')}
                            />
                            <label className="form-check-label fw-semibold small" htmlFor="isNptelSubjectSwitch">
                                <i className="bi bi-laptop me-1 text-danger"></i>NPTEL / Swayam (MOOC) Online Subject
                            </label>
                        </div>
                    </div>
                    {watch('is_nptel') && (
                        <div className="col-12 mt-2">
                            <div className="p-3 rounded-3 border border-danger border-opacity-25" style={{ backgroundColor: '#fff5f5' }}>
                                <label className="form-label small fw-bold text-danger mb-2 d-block">
                                    <i className="bi bi-gear-fill me-1"></i>NPTEL / Online Applicable Mode (Select which part is Online):
                                </label>
                                {subjectType === 'theory' ? (
                                    <div className="alert alert-primary py-2 px-3 mb-0 small border border-primary border-opacity-25">
                                        <i className="bi bi-laptop me-2"></i>
                                        <strong>Lecture / Theory Only:</strong> Since this is a Theory-only subject, NPTEL mode is automatically set to Lecture Online.
                                    </div>
                                ) : subjectType === 'lab' ? (
                                    <div className="alert alert-info py-2 px-3 mb-0 small border border-info border-opacity-25">
                                        <i className="bi bi-laptop me-2"></i>
                                        <strong>Lab / Practical Only:</strong> Since this is a Lab-only subject, NPTEL mode is automatically set to Lab Online.
                                    </div>
                                ) : (
                                    <>
                                        <div className="d-flex flex-wrap gap-3">
                                            <div className="form-check">
                                                <input
                                                    className="form-check-input"
                                                    type="radio"
                                                    value="BOTH"
                                                    id="nptelModeBoth"
                                                    {...register('nptel_mode')}
                                                />
                                                <label className="form-check-label small fw-semibold" htmlFor="nptelModeBoth">
                                                    Both (Theory + Lab Online)
                                                </label>
                                            </div>
                                            <div className="form-check">
                                                <input
                                                    className="form-check-input"
                                                    type="radio"
                                                    value="THEORY"
                                                    id="nptelModeTheory"
                                                    {...register('nptel_mode')}
                                                />
                                                <label className="form-check-label small fw-semibold text-primary" htmlFor="nptelModeTheory">
                                                    Lecture / Theory Only (Lab scheduled physically)
                                                </label>
                                            </div>
                                            <div className="form-check">
                                                <input
                                                    className="form-check-input"
                                                    type="radio"
                                                    value="LAB"
                                                    id="nptelModeLab"
                                                    {...register('nptel_mode')}
                                                />
                                                <label className="form-check-label small fw-semibold text-info" htmlFor="nptelModeLab">
                                                    Lab / Practical Only (Theory scheduled physically)
                                                </label>
                                            </div>
                                        </div>
                                        <div className="form-text small text-muted mt-2 mb-0">
                                            <em>Note: Only the selected NPTEL component will be scheduled once/week as online. Any remaining physical component (e.g. physical lab) will be scheduled in real classrooms!</em>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>
                {watch('is_elective') && (
                    <div className="form-text mt-2 text-warning fw-medium bg-warning bg-opacity-10 p-2 rounded border border-warning border-opacity-25" style={{ fontSize: '0.8rem' }}>
                        <i className="bi bi-info-circle me-1"></i>
                        Note: This subject will not be automatically assigned. You must assign it to specific classes in the <strong>Classes & Sections</strong> menu.
                    </div>
                )}
            </FormModal>

            <div className={`modal fade ${showBulkUpload ? 'show d-block' : ''}`} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex="-1">
                <div className="modal-dialog modal-dialog-centered">
                    <div className="modal-content border-0 shadow">
                        <div className="modal-header border-bottom-0">
                            <h5 className="modal-title fw-bold">Bulk Upload Subjects</h5>
                            <button type="button" className="btn-close" onClick={() => setShowBulkUpload(false)}></button>
                        </div>
                        <div className="modal-body pb-0">
                            <div className="alert alert-info border-0 rounded-4 mb-4">
                                <div className="d-flex">
                                    <i className="bi bi-info-circle-fill fs-4 me-3"></i>
                                    <div>
                                        <h6 className="fw-bold mb-1">Download Template</h6>
                                        <p className="small mb-2">Please use the standard Excel/CSV template for bulk uploading subjects.</p>
                                        <p className="small mb-2 fw-semibold">Mandatory fields: Sr, Subject Name, Department Code (e.g. CSE), Type (theory/lab/both), Total Credits, L, T, P</p>
                                        <p className="small mb-2">Note: Short Name is optional (generated automatically if blank).</p>
                                        <p className="small mb-2 text-primary fw-semibold"><i className="bi bi-info-circle me-1"></i>Note: For 'Department Code', enter your department short code (e.g. CSE, ET, ME, CE, BCA) or name.</p>
                                        <p className="small mb-3 text-danger fw-semibold"><i className="bi bi-info-circle me-1"></i>Note: All subjects uploaded via template will be added as normal (Non-NPTEL) subjects by default. To enable NPTEL / Swayam mode for any subject, please edit it manually after uploading.</p>
                                        <button onClick={handleDownloadTemplate} className="btn btn-sm btn-outline-info bg-white">
                                            <i className="bi bi-download me-1"></i> Download Template
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <form onSubmit={handleBulkUpload}>
                                <div className="mb-3">
                                    <label className="form-label fw-semibold small">Upload Excel/CSV File <span className="text-danger">*</span></label>
                                    <input
                                        type="file"
                                        className="form-control"
                                        accept=".csv, .xlsx, .xls"
                                        onChange={(e) => setBulkFile(e.target.files[0])}
                                    />
                                </div>

                                {bulkSuccess && (
                                    <div className="alert alert-success border-0 rounded-3 small py-2">
                                        <i className="bi bi-check-circle-fill me-2"></i>{bulkSuccess}
                                    </div>
                                )}

                                {bulkErrors && bulkErrors.length > 0 && (
                                    <div className="alert alert-danger border-0 rounded-3 small py-2 max-h-200 overflow-auto" style={{ maxHeight: '150px' }}>
                                        <div className="fw-bold mb-1"><i className="bi bi-exclamation-triangle-fill me-2"></i>Errors found:</div>
                                        <ul className="mb-0 ps-3">
                                            {bulkErrors.map((err, idx) => (
                                                <li key={idx}>{err}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                <div className="d-flex justify-content-end gap-2 mt-4 mb-3">
                                    <button type="button" className="btn btn-light rounded-pill px-4" onClick={() => setShowBulkUpload(false)}>Cancel</button>
                                    <button type="submit" className="btn btn-primary rounded-pill px-4" disabled={!bulkFile}>
                                        <i className="bi bi-upload me-2"></i>Upload
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            </div>

            {/* Delete By Department Modal */}
            <div className={`modal fade ${showDeleteModal ? 'show d-block' : ''}`} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex="-1">
                <div className="modal-dialog modal-dialog-centered">
                    <div className="modal-content border-0 shadow-lg rounded-4">
                        <div className="modal-header border-bottom-0 pb-0">
                            <h5 className="modal-title fw-bold text-danger">
                                <i className="bi bi-exclamation-octagon-fill me-2"></i> Delete Subjects
                            </h5>
                            <button type="button" className="btn-close" onClick={() => setShowDeleteModal(false)}></button>
                        </div>
                        <div className="modal-body pt-3">
                            <p className="text-muted mb-4">Select the department to completely wipe out its curriculum. <strong>Warning: This action cannot be undone!</strong></p>
                            <div className="mb-3">
                                <label className="form-label fw-semibold small">Select Department <span className="text-danger">*</span></label>
                                <select
                                    className="form-select form-select-lg border-2"
                                    value={deleteDeptFilter}
                                    onChange={(e) => setDeleteDeptFilter(e.target.value)}
                                >
                                    <option value="" disabled>-- Select a department --</option>
                                    <option value="all" className="text-danger fw-bold">ALL DEPARTMENTS</option>
                                    {departments.map(d => (
                                        <option key={d.id} value={d.id}>{d.name} ({d.short_code})</option>
                                    ))}
                                </select>
                            </div>

                            <div className="mb-4">
                                <label className="form-label fw-semibold small">Select Class / Semester (Optional)</label>
                                <select
                                    className="form-select border-2"
                                    value={deleteClassFilter}
                                    onChange={(e) => setDeleteClassFilter(e.target.value)}
                                >
                                    <option value="">-- All Classes of Selected Department --</option>
                                    {classOptions.map((cls, idx) => (
                                        <option key={idx} value={JSON.stringify(cls)}>Semester {cls.semester} - {cls.program_name}</option>
                                    ))}
                                </select>
                            </div>

                            {deleteDeptFilter && (
                                <div className="alert alert-danger border-0 bg-danger bg-opacity-10 text-danger rounded-3 d-flex align-items-center mb-2">
                                    <i className="bi bi-exclamation-triangle-fill fs-4 me-3"></i>
                                    <div>
                                        <div className="fw-bold mb-1">Confirm Deletion</div>
                                        <div className="small">
                                            Are you absolutely sure you want to delete subjects for
                                            <strong> {deleteDeptFilter === 'all' ? 'All Departments' : departments.find(d => d.id === parseInt(deleteDeptFilter))?.name}</strong>
                                            {deleteClassFilter ? ` (${JSON.parse(deleteClassFilter).program_name} - Semester ${JSON.parse(deleteClassFilter).semester})` : ''}?
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="d-flex justify-content-end gap-2 mt-4 pb-2">
                                <button type="button" className="btn btn-light rounded-pill px-4 fw-semibold" onClick={() => setShowDeleteModal(false)}>Cancel</button>
                                <button type="button" className="btn btn-danger rounded-pill px-4 fw-semibold" disabled={!deleteDeptFilter} onClick={confirmDeleteByDepartment}>
                                    <i className="bi bi-trash3 me-1"></i> Delete Permanently
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                {/* Overview Details Modal */}
                {showOverviewModal && (
                    <>
                        <div className="modal-backdrop fade show" style={{ zIndex: 1050 }}></div>
                        <div className="modal fade show d-block" tabIndex="-1" style={{ zIndex: 1055 }}>
                            <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
                                <div className="modal-content border-0 shadow-lg" style={{ borderRadius: '16px' }}>
                                    <div className="modal-header border-bottom-0 pb-0" style={{ background: 'var(--app-surface, #fff)', borderTopLeftRadius: '16px', borderTopRightRadius: '16px' }}>
                                        <div>
                                            <h5 className="modal-title fw-bold" style={{ color: 'var(--text-primary)', fontSize: '1.25rem' }}>
                                                {overviewActiveTab === 'stats' ? 'Subjects Overview' : 'Subject Details'}
                                            </h5>
                                            <p className="text-muted mb-0" style={{ fontSize: '0.9rem' }}>
                                                {overviewActiveTab === 'stats' ? 'Detailed breakdown of subjects, electives, and NPTEL allocations across all departments.' : 'List of subjects for the selected category.'}
                                            </p>
                                        </div>
                                        <button type="button" className="btn-close" onClick={() => setShowOverviewModal(false)}></button>
                                    </div>
                                    <div className="modal-body pt-3 pb-4" style={{ background: 'var(--app-bg, #f8fafc)' }}>
                                        {overviewLoading ? (
                                            <div className="d-flex justify-content-center py-5">
                                                <div className="spinner-border text-primary" role="status">
                                                    <span className="visually-hidden">Loading...</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="d-flex flex-column gap-4">
                                                {overviewActiveTab === 'stats' ? (
                                                <div className="card border-0 shadow-sm rounded-4 overflow-hidden">
                                                    {/* Department Stats Table */}
                                                    <div className="card-header bg-white border-bottom py-3 d-flex align-items-center">
                                                        <i className="bi bi-building-fill text-primary me-2 fs-5"></i>
                                                        <h6 className="mb-0 fw-bold">Department-wise Overview</h6>
                                                    </div>
                                                    <div className="card-body p-0">
                                                        <div className="table-responsive">
                                                            <table className="table table-hover align-middle mb-0 custom-table">
                                                                <thead className="table-light">
                                                                    <tr>
                                                                        <th className="px-4 py-3 text-uppercase text-muted" style={{ fontSize: '12px', letterSpacing: '0.5px' }}>Department</th>
                                                                        <th className="text-center px-3 py-3 text-uppercase text-muted" style={{ fontSize: '12px', letterSpacing: '0.5px' }}>Total</th>
                                                                        <th className="text-center px-3 py-3 text-uppercase text-muted" style={{ fontSize: '12px', letterSpacing: '0.5px' }}>Theory</th>
                                                                        <th className="text-center px-3 py-3 text-uppercase text-muted" style={{ fontSize: '12px', letterSpacing: '0.5px' }}>Lab</th>
                                                                        <th className="text-center px-3 py-3 text-uppercase text-muted" style={{ fontSize: '12px', letterSpacing: '0.5px' }}>Electives</th>
                                                                        <th className="text-center px-3 py-3 text-uppercase text-muted" style={{ fontSize: '12px', letterSpacing: '0.5px' }}>NPTEL</th>
                                                                        <th className="text-center px-3 py-3 text-uppercase text-muted" style={{ fontSize: '12px', letterSpacing: '0.5px' }}>Allocated</th>
                                                                        <th className="text-center px-3 py-3 text-uppercase text-muted" style={{ fontSize: '12px', letterSpacing: '0.5px' }}>Unallocated</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {overviewDetails.departmentStats?.length > 0 ? overviewDetails.departmentStats.map((dept, idx) => (
                                                                        <tr key={idx}>
                                                                            <td className="px-4 py-3">
                                                                                <div className="d-flex align-items-center gap-2">
                                                                                    <span className="badge bg-primary bg-opacity-10 text-primary">{dept.short_code}</span>
                                                                                    <span className="fw-semibold text-dark">{dept.department_name}</span>
                                                                                </div>
                                                                            </td>
                                                                            <td className="text-center px-3 py-3 fw-bold">{dept.total_subjects}</td>
                                                                            <td className="text-center px-3 py-3 fw-semibold text-secondary">{dept.theory}</td>
                                                                            <td className="text-center px-3 py-3 fw-semibold text-secondary">{dept.lab}</td>
                                                                            <td className="text-center px-3 py-3 fw-bold text-info">{dept.total_active_electives}</td>
                                                                            <td className="text-center px-3 py-3 fw-semibold text-danger">{dept.nptel}</td>
                                                                            <td className="text-center px-3 py-3 fw-bold text-success">{dept.allocated}</td>
                                                                            <td className="text-center px-3 py-3 fw-bold text-warning">{dept.unallocated}</td>
                                                                        </tr>
                                                                    )) : (
                                                                        <tr><td colSpan="8" className="text-center py-4 text-muted">No data found</td></tr>
                                                                    )}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </div>
                                                </div>
                                                ) : (
                                                <div className="card border-0 shadow-sm rounded-4 overflow-hidden">
                                                    <div className="card-header bg-white border-bottom py-3 d-flex align-items-center">
                                                        <i className="bi bi-list-ul text-primary me-2 fs-5"></i>
                                                        <h6 className="mb-0 fw-bold">
                                                            {overviewActiveTab === 'theory' && 'Theory Subjects'}
                                                            {overviewActiveTab === 'lab' && 'Lab Subjects'}
                                                            {overviewActiveTab === 'allocated' && 'Allocated Subjects'}
                                                            {overviewActiveTab === 'unallocated' && 'Unallocated Subjects'}
                                                            {overviewActiveTab === 'nptel' && 'NPTEL / SWAYAM Subjects'}
                                                        </h6>
                                                    </div>
                                                    <div className="card-body p-0">
                                                        <div className="table-responsive" style={{ maxHeight: '60vh' }}>
                                                            <table className="table table-hover align-middle mb-0 custom-table">
                                                                <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                                                                    <tr>
                                                                        <th className="px-4 py-3 text-uppercase text-muted" style={{ fontSize: '12px', letterSpacing: '0.5px' }}>Subject</th>
                                                                        <th className="px-3 py-3 text-uppercase text-muted" style={{ fontSize: '12px', letterSpacing: '0.5px' }}>Department</th>
                                                                        <th className="px-3 py-3 text-uppercase text-muted" style={{ fontSize: '12px', letterSpacing: '0.5px' }}>Course & Sem</th>
                                                                        <th className="text-center px-3 py-3 text-uppercase text-muted" style={{ fontSize: '12px', letterSpacing: '0.5px' }}>Credits</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {modalSubjects.length > 0 ? modalSubjects.map((sub, idx) => (
                                                                        <tr key={sub.id}>
                                                                            <td className="px-4 py-3">
                                                                                <div className="fw-bold text-dark">{sub.full_name}</div>
                                                                                <div className="small text-muted font-monospace">{sub.subject_code ? `${sub.subject_code} | ` : ''}{sub.short_code}</div>
                                                                            </td>
                                                                            <td className="px-3 py-3 fw-medium text-dark">{sub.department_code}</td>
                                                                            <td className="px-3 py-3">
                                                                                <div className="fw-medium text-dark">{sub.program_name || 'All Courses'}</div>
                                                                                <div className="small text-muted">{sub.semester ? `Semester ${sub.semester}` : 'All Semesters'}</div>
                                                                            </td>
                                                                            <td className="text-center px-3 py-3 fw-bold">{Number(sub.total_credits)}</td>
                                                                        </tr>
                                                                    )) : (
                                                                        <tr><td colSpan="4" className="text-center py-4 text-muted">No subjects found</td></tr>
                                                                    )}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </div>
                                                </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default Subjects;
