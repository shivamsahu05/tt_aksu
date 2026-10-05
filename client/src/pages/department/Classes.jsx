import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import { toast } from 'react-toastify';
import { safeDelete, showSuccess } from '../../utils/alerts';
import FormModal from '../../components/common/FormModal';
import PageHeader from '../../components/common/PageHeader';
import DataTable from '../../components/common/DataTable';
import ActionButtons from '../../components/common/ActionButtons';
import MergeSectionsModal from '../../components/admin/MergeSectionsModal';
import { useForm, useFieldArray } from 'react-hook-form';
import Swal from 'sweetalert2';
import { useAuth } from '../../context/AuthContext';
import { exportToExcel } from '../../utils/exportToExcel';

const Classes = () => {
    const { user } = useAuth();
    const isDeptAdmin = ['DEPARTMENT_ADMIN', 'FACULTY'].includes(user?.role);
    const [classes, setClasses] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [rooms, setRooms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [overview, setOverview] = useState({ total: 0, active: 0, inactive: 0, withElectives: 0 });

    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [deptFilter, setDeptFilter] = useState('');
    const [sessionFilter, setSessionFilter] = useState('');

    // Pagination
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [showModal, setShowModal] = useState(false);
    const [showMergeGroups, setShowMergeGroups] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [selectedIds, setSelectedIds] = useState([]);

    // Bulk Upload state
    const [showBulkUpload, setShowBulkUpload] = useState(false);
    const [bulkFile, setBulkFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [bulkErrors, setBulkErrors] = useState(null);
    const [bulkSummary, setBulkSummary] = useState(null);

    const [availableElectives, setAvailableElectives] = useState([]);
    const [selectedElectives, setSelectedElectives] = useState([]);

    const { register, control, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm({
        defaultValues: {
            sections: [{ section_name: 'A', student_strength: 0, home_room_id: '' }]
        }
    });

    const { fields, append, remove } = useFieldArray({
        control,
        name: "sections"
    });

    const fetchDropdowns = async () => {
        try {
            const [deptRes, sessRes, roomRes] = await Promise.all([
                api.get('/departments?limit=100'),
                api.get('/sessions?limit=100'),
                api.get('/rooms?limit=100')
            ]);
            if (deptRes.data.success) setDepartments(deptRes.data.data);
            if (sessRes.data.success) {
                setSessions(sessRes.data.data);
                // Set default session filter to active session
                const activeSession = sessRes.data.data.find(s => s.is_active);
                if (activeSession) setSessionFilter(activeSession.id.toString());
            }
            if (roomRes.data.success) setRooms(roomRes.data.data);
        } catch (error) {
            console.error('Failed to fetch dropdowns');
        }
    };

    const fetchClasses = async () => {
        try {
            setLoading(true);
            let url = `/classes?page=${page}&limit=10&search=${searchTerm}`;
            if (deptFilter) url += `&department_id=${deptFilter}`;
            if (sessionFilter) url += `&session_id=${sessionFilter}`;

            const res = await api.get(url);
            if (res.data.success) {
                setClasses(res.data.data);
                setTotalPages(res.data.pagination.totalPages);
                if (res.data.overview) setOverview(res.data.overview);
                setSelectedIds([]);
            }
        } catch (error) {
            toast.error('Failed to fetch classes');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDropdowns();
    }, []);

    useEffect(() => {
        fetchClasses();
    }, [page, searchTerm, deptFilter, sessionFilter]);

    const watchDept = watch('department_id');
    const watchProgram = watch('program_name');
    const watchSemester = watch('semester');

    useEffect(() => {
        const fetchElectives = async () => {
            if (watchDept && watchProgram && watchSemester) {
                try {
                    const res = await api.get(`/subjects?is_elective=1&department_id=${watchDept}&program_name=${encodeURIComponent(watchProgram)}&semester=${watchSemester}&limit=100`);
                    if (res.data.success) {
                        setAvailableElectives(res.data.data);
                    }
                } catch (err) {
                    console.error("Failed to fetch electives");
                }
            } else {
                setAvailableElectives([]);
            }
        };
        fetchElectives();
    }, [watchDept, watchProgram, watchSemester]);

    const toggleElective = (id) => {
        setSelectedElectives(prev =>
            prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]
        );
    };

    const openAddModal = () => {
        setEditItem(null);
        setSelectedElectives([]);
        reset({
            department_id: isDeptAdmin ? user.department_id : '',
            session_id: sessionFilter || '',
            program_name: '',
            semester: '',
            is_active: true,
            sections: [{ section_name: 'A', student_strength: 0, home_room_id: '', mode: 'Offline' }]
        });
        setShowModal(true);
    };

    const openEditModal = async (classItem) => {
        try {
            // Fetch full class details including sections
            const res = await api.get(`/classes/${classItem.id}`);
            if (res.data.success) {
                const fullClass = res.data.data;
                setEditItem(fullClass);
                setSelectedElectives(fullClass.elective_subject_ids || []);
                reset({
                    department_id: fullClass.department_id,
                    session_id: fullClass.session_id,
                    program_name: fullClass.program_name,
                    semester: fullClass.semester,
                    is_active: fullClass.is_active !== undefined ? Boolean(fullClass.is_active) : true,
                    sections: fullClass.sections.length > 0
                        ? fullClass.sections.map(s => ({
                            section_name: s.section_name,
                            student_strength: s.student_strength,
                            home_room_id: s.home_room_id || '',
                            mode: s.mode || 'Offline'
                        }))
                        : [{ section_name: 'A', student_strength: 0, home_room_id: '', mode: 'Offline' }]
                });
                setShowModal(true);
            }
        } catch (error) {
            toast.error('Failed to fetch class details');
        }
    };

    const onSubmit = async (data) => {
        try {
            // Ensure numbers
            const payload = {
                ...data,
                department_id: parseInt(data.department_id),
                session_id: parseInt(data.session_id),
                semester: parseInt(data.semester),
                sections: data.sections.map(s => ({
                    ...s,
                    student_strength: s.student_strength ? parseInt(s.student_strength) : 0,
                    home_room_id: s.home_room_id ? parseInt(s.home_room_id) : null,
                    mode: s.mode || 'Offline'
                })),
                elective_subject_ids: selectedElectives,
                is_active: data.is_active ? 1 : 0
            };

            if (editItem) {
                await api.put(`/classes/${editItem.id}`, payload);
                showSuccess('Class updated successfully');
            } else {
                await api.post('/classes', payload);
                showSuccess('Class added successfully');
            }
            setShowModal(false);
            fetchClasses();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Operation failed');
        }
    };

    const handleDelete = (id, name) => {
        safeDelete(name, async () => {
            try {
                await api.delete(`/classes/${id}`);
                showSuccess('Class deleted successfully');
                fetchClasses();
            } catch (error) {
                toast.error(error.response?.data?.message || 'Failed to delete class');
            }
        });
    };

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            setSelectedIds(classes.map(c => c.id));
        } else {
            setSelectedIds([]);
        }
    };

    const handleSelect = (id) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    };

    const handleBulkDelete = () => {
        if (selectedIds.length === 0) return;

        Swal.fire({
            title: `Delete ${selectedIds.length} Classes?`,
            text: "Are you sure? This action cannot be undone.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Yes, delete them!'
        }).then((result) => {
            if (result.isConfirmed) {
                Swal.fire({
                    title: 'Final Confirmation',
                    text: `You are about to permanently delete ${selectedIds.length} classes. Proceed?`,
                    icon: 'error',
                    showCancelButton: true,
                    confirmButtonColor: '#d33',
                    cancelButtonColor: '#3085d6',
                    confirmButtonText: 'Yes, permanently delete'
                }).then(async (finalResult) => {
                    if (finalResult.isConfirmed) {
                        try {
                            const res = await api.post('/classes/bulk-delete', { ids: selectedIds });
                            if (res.data.success) {
                                toast.success(res.data.message);
                                fetchClasses();
                            }
                        } catch (error) {
                            toast.error(error.response?.data?.message || 'Failed to delete classes');
                        }
                    }
                });
            }
        });
    };

    const handleDeleteByDepartment = async () => {
        const deptOptions = departments.map(d =>
            `<div class="form-check text-start mb-1">
                <input class="form-check-input dept-check" type="checkbox" value="${d.id}" id="dept-${d.id}">
                <label class="form-check-label small" for="dept-${d.id}">${d.name} <span class="text-muted">(${d.short_code})</span></label>
            </div>`
        ).join('');

        const { isConfirmed, value: selectedIds } = await Swal.fire({
            title: '<span style="color:#dc3545"><i class="bi bi-trash3-fill me-2"></i>Delete Classes by Department</span>',
            html: `
                <p class="text-muted small mb-3">Select one or more departments. <strong>All classes and sections</strong> assigned to those departments will be permanently deleted.</p>
                <div style="max-height:260px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;text-align:left">
                    ${deptOptions}
                </div>
                <div class="mt-2 text-start">
                    <button type="button" class="btn btn-sm btn-link text-muted p-0" onclick="document.querySelectorAll('.dept-check').forEach(c=>c.checked=true)">Select All</button>
                    &nbsp;|&nbsp;
                    <button type="button" class="btn btn-sm btn-link text-muted p-0" onclick="document.querySelectorAll('.dept-check').forEach(c=>c.checked=false)">Deselect All</button>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: '<i class="bi bi-trash3-fill me-1"></i> Delete Selected',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#dc3545',
            cancelButtonColor: '#64748b',
            focusConfirm: false,
            preConfirm: () => {
                const checked = [...document.querySelectorAll('.dept-check:checked')].map(c => parseInt(c.value));
                if (checked.length === 0) {
                    Swal.showValidationMessage('Please select at least one department.');
                    return false;
                }
                return checked;
            }
        });

        if (!isConfirmed || !selectedIds) return;

        const selectedNames = departments.filter(d => selectedIds.includes(d.id)).map(d => d.name).join(', ');

        const { isConfirmed: finalConfirm } = await Swal.fire({
            title: 'Are you absolutely sure?',
            html: `<p class="mb-2">This will <strong>permanently delete ALL classes and sections</strong> from:</p><p class="fw-bold text-danger">${selectedNames}</p><p class="text-muted small">This action <strong>cannot be undone</strong>.</p>`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Yes, Delete Permanently',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#dc3545',
            cancelButtonColor: '#64748b',
        });

        if (!finalConfirm) return;

        try {
            const res = await api.post('/classes/bulk-delete', { department_ids: selectedIds });
            if (res.data.success) {
                Swal.fire('Deleted!', res.data.message, 'success');
                fetchClasses();
            }
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to delete classes');
        }
    };

    const handleBulkUpload = async (e) => {
        e.preventDefault();
        if (!bulkFile) {
            toast.warning('Please select a CSV file');
            return;
        }

        const formData = new FormData();
        formData.append('file', bulkFile);

        try {
            setIsUploading(true);
            setBulkErrors(null);
            setBulkSummary(null);
            const res = await api.post('/classes/bulk-upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            if (res.data.success) {
                setBulkSummary(res.data.summary);
                if (res.data.errors && res.data.errors.length > 0) {
                    setBulkErrors(res.data.errors);
                    toast.warning(`Upload complete with some errors.`);
                } else {
                    toast.success(res.data.message);
                    // Modal stays open so user can see Added/Skipped summary
                }
                fetchClasses();
            }
        } catch (error) {
            setBulkErrors([error.response?.data?.message || 'Server error during upload']);
        } finally {
            setIsUploading(false);
        }
    };

    // Determine Semesters based on session
    const getSemestersForSession = (sessionId) => {
        if (!sessionId) return [1, 2, 3, 4, 5, 6, 7, 8];
        const session = sessions.find(s => s.id === parseInt(sessionId));
        if (!session) return [1, 2, 3, 4, 5, 6, 7, 8];
        const name = session.name.toLowerCase();
        if (name.includes('jul') || name.includes('aug') || name.includes('odd')) return [1, 3, 5, 7];
        if (name.includes('jan') || name.includes('feb') || name.includes('even')) return [2, 4, 6, 8];
        return [1, 2, 3, 4, 5, 6, 7, 8];
    };

    const formSessionId = watch('session_id');
    const availableSemesters = getSemestersForSession(formSessionId);
    const filterSemesters = getSemestersForSession(sessionFilter);

    const columns = [
        {
            label: (
                <div className="d-flex align-items-center">
                    <input
                        type="checkbox"
                        className="form-check-input me-3"
                        onChange={handleSelectAll}
                        checked={selectedIds.length === classes.length && classes.length > 0}
                    />
                    <span className="text-muted fw-semibold">#</span>
                </div>
            ),
            className: 'ps-4'
        },
        { label: 'Program Name' },
        { label: 'Department' },
        { label: 'Semester' },
        { label: 'Sections' },
        { label: 'Academic Session' },
        { label: 'Actions', className: 'text-end pe-4' }
    ];

    return (
        <div>
            <PageHeader
                title="Classes & Sections"
                subtitle="Manage programs, semesters, and sections"
                icon="bi-diagram-3"
                actionButton={{ label: "Add Class", icon: "bi-plus-lg", onClick: openAddModal }}
            />

            {/* Overview Section */}
            <div className="row g-3 mb-4 px-2 mt-1">
                <div className="col-md-3">
                    <div className="card border-0 shadow-sm rounded-4 h-100 overflow-hidden">
                        <div className="card-body d-flex align-items-center p-4">
                            <div className="bg-primary bg-opacity-10 rounded-circle d-flex align-items-center justify-content-center me-3" style={{ width: '48px', height: '48px' }}>
                                <i className="bi bi-diagram-3 text-primary fs-4"></i>
                            </div>
                            <div>
                                <h6 className="text-muted mb-1 fw-semibold">Total Classes</h6>
                                <h3 className="mb-0 fw-bold">{overview.total}</h3>
                            </div>
                        </div>
                        <div className="bg-primary" style={{ height: '4px', width: '100%' }}></div>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="card border-0 shadow-sm rounded-4 h-100 overflow-hidden">
                        <div className="card-body d-flex align-items-center p-4">
                            <div className="bg-success bg-opacity-10 rounded-circle d-flex align-items-center justify-content-center me-3" style={{ width: '48px', height: '48px' }}>
                                <i className="bi bi-check-circle text-success fs-4"></i>
                            </div>
                            <div>
                                <h6 className="text-muted mb-1 fw-semibold">Active Classes</h6>
                                <h3 className="mb-0 fw-bold">{overview.active}</h3>
                            </div>
                        </div>
                        <div className="bg-success" style={{ height: '4px', width: '100%' }}></div>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="card border-0 shadow-sm rounded-4 h-100 overflow-hidden">
                        <div className="card-body d-flex align-items-center p-4">
                            <div className="bg-danger bg-opacity-10 rounded-circle d-flex align-items-center justify-content-center me-3" style={{ width: '48px', height: '48px' }}>
                                <i className="bi bi-x-circle text-danger fs-4"></i>
                            </div>
                            <div>
                                <h6 className="text-muted mb-1 fw-semibold">Inactive Classes</h6>
                                <h3 className="mb-0 fw-bold">{overview.inactive}</h3>
                            </div>
                        </div>
                        <div className="bg-danger" style={{ height: '4px', width: '100%' }}></div>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="card border-0 shadow-sm rounded-4 h-100 overflow-hidden">
                        <div className="card-body d-flex align-items-center p-4">
                            <div className="bg-warning bg-opacity-10 rounded-circle d-flex align-items-center justify-content-center me-3" style={{ width: '48px', height: '48px' }}>
                                <i className="bi bi-star text-warning fs-4"></i>
                            </div>
                            <div>
                                <h6 className="text-muted mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>Classes w/ Electives</h6>
                                <h3 className="mb-0 fw-bold">{overview.withElectives} <span className="fs-6 text-muted fw-normal">/ {overview.total}</span></h3>
                            </div>
                        </div>
                        <div className="bg-warning" style={{ height: '4px', width: '100%' }}></div>
                    </div>
                </div>
            </div>

            <div className="d-flex flex-wrap justify-content-start justify-content-sm-end mb-3 px-2 gap-2">
                <button onClick={() => setShowMergeGroups(true)} className="btn btn-sm btn-info text-white rounded-pill shadow-sm d-inline-flex align-items-center justify-content-center text-nowrap">
                    <i className="bi bi-diagram-2 me-1"></i>
                    <span className="d-none d-sm-inline">Merge Sections</span>
                    <span className="d-sm-none">Merge</span>
                </button>
                {selectedIds.length > 0 && (
                    <button onClick={handleBulkDelete} className="btn btn-sm btn-danger rounded-pill shadow-sm d-inline-flex align-items-center justify-content-center text-nowrap">
                        <i className="bi bi-trash me-1"></i>
                        <span className="d-none d-sm-inline">Delete Selected ({selectedIds.length})</span>
                        <span className="d-sm-none">Del ({selectedIds.length})</span>
                    </button>
                )}
                <button onClick={handleDeleteByDepartment} className="btn btn-sm btn-outline-danger rounded-pill shadow-sm d-inline-flex align-items-center justify-content-center text-nowrap">
                    <i className="bi bi-trash3 me-1"></i>
                    <span className="d-none d-sm-inline">Delete by Department</span>
                    <span className="d-sm-none">Delete</span>
                </button>
                <button onClick={() => { setBulkFile(null); setBulkErrors(null); setBulkSummary(null); setShowBulkUpload(true); }} className="btn btn-sm btn-primary rounded-pill shadow-sm d-inline-flex align-items-center justify-content-center text-nowrap">
                    <i className="bi bi-cloud-upload me-1"></i>
                    <span className="d-none d-sm-inline">Bulk Upload Classes</span>
                    <span className="d-sm-none">Bulk Upload</span>
                </button>
                <button
                    onClick={() => exportToExcel({
                        filename: 'Classes_Sections',
                        sheetName: 'Classes',
                        columns: [
                            { header: 'Program Name', key: 'program_name' },
                            { header: 'Department', key: 'department_name' },
                            { header: 'Session', key: 'session_name' },
                            { header: 'Semester', key: 'semester' },
                            { header: 'Total Sections', key: 'total_sections' },
                            { header: 'Total Students', key: 'total_strength' },
                        ],
                        data: classes,
                        notes: [
                            '✅ Included: Program Name, Department, Session, Semester, Sections Count, Total Students',
                            '❌ Excluded: Section-level room assignments, Elective details, Merge group info',
                            'ℹ️ Use session & dept filters to narrow export to specific data.',
                        ],
                    })}
                    className="btn btn-outline-success rounded-pill shadow-sm flex-shrink-0"
                >
                    <i className="bi bi-file-earmark-excel me-1"></i>
                    <span className="d-none d-sm-inline"> Export Excel</span>
                    <span className="d-sm-none"> Export</span>
                </button>
            </div>

            <div className="card border-0 shadow-sm rounded-4">
                <div className="card-header border-bottom-0 py-3 d-flex flex-wrap justify-content-between align-items-center gap-3" style={{ background: 'var(--card-bg)' }}>
                    <div className="input-group w-auto flex-grow-1" style={{ maxWidth: '300px' }}>
                        <span className="input-group-text bg-light border-end-0 rounded-start-pill">
                            <i className="bi bi-search text-muted"></i>
                        </span>
                        <input
                            type="text"
                            className="form-control bg-light border-start-0 rounded-end-pill"
                            placeholder="Search program..."
                            value={searchTerm}
                            onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
                        />
                    </div>
                    <div className="d-flex gap-2 w-auto">
                        <select className="form-select bg-light rounded-pill border-0 px-4" value={deptFilter} onChange={(e) => { setDeptFilter(e.target.value); setPage(1); }}>
                            <option value="">All Departments</option>
                            {departments.map(dept => (
                                <option key={dept.id} value={dept.id}>{dept.short_code}</option>
                            ))}
                        </select>
                        <select className="form-select bg-light rounded-pill border-0 px-4" value={sessionFilter} onChange={(e) => { setSessionFilter(e.target.value); setPage(1); }}>
                            <option value="">All Sessions</option>
                            {sessions.map(s => (
                                <option key={s.id} value={s.id}>{s.name} {s.is_active && '(Current)'}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <DataTable
                    columns={columns}
                    data={classes}
                    loading={loading}
                    page={page}
                    totalPages={totalPages}
                    setPage={setPage}
                    emptyMessage="No classes found."
                    emptyIcon="bi-calendar2-x"
                    renderRow={(cls) => (
                        <tr key={cls.id}>
                            <td className="ps-4">
                                <div className="d-flex align-items-center">
                                    <input
                                        type="checkbox"
                                        className="form-check-input me-3"
                                        checked={selectedIds.includes(cls.id)}
                                        onChange={() => handleSelect(cls.id)}
                                    />
                                    <span className="text-muted fw-medium">{((page - 1) * 10) + (classes.indexOf(cls) + 1)}</span>
                                </div>
                            </td>
                            <td>
                                <div className="d-flex align-items-center gap-2">
                                    <div className="fw-bold text-dark">{cls.program_name}</div>
                                    {cls.is_active === 0 && <span className="badge bg-danger bg-opacity-10 text-danger border border-danger border-opacity-25 rounded-pill px-2">Inactive</span>}
                                </div>
                            </td>
                            <td>
                                <div className="fw-medium text-dark">{cls.department_code}</div>
                            </td>
                            <td>
                                <div className="fw-medium text-primary bg-primary bg-opacity-10 rounded-pill px-3 py-1 d-inline-block">Sem {cls.semester}</div>
                            </td>
                            <td>
                                <div className="d-flex align-items-center flex-wrap gap-1">
                                    <span className="badge bg-light text-dark border px-2 mb-1">
                                        {cls.section_count <= 1
                                            ? '1 Section'
                                            : `${cls.section_count} Sections (${Array.from({ length: cls.section_count }, (_, i) => `B${i + 1}`).join(', ')})`}
                                    </span>
                                    <span className="badge bg-info bg-opacity-10 text-info border px-2 mb-1">
                                        <i className="bi bi-people-fill me-1"></i>
                                        Strength: {cls.total_strength || 0}
                                    </span>
                                    {cls.section_details && cls.section_details.split(',').some(s => s.split(':')[1] === 'Online') && (
                                        <span className="badge bg-info text-dark border px-2 mb-1"><i className="bi bi-laptop me-1"></i>Online</span>
                                    )}
                                </div>
                            </td>
                            <td>
                                <div className="small">{cls.session_name}</div>
                                {cls.session_active === 1 && <span className="badge bg-success bg-opacity-10 text-success rounded-pill px-2 mt-1">Current</span>}
                            </td>
                            <td className="pe-4">
                                <ActionButtons
                                    onEdit={() => openEditModal(cls)}
                                    onDelete={() => handleDelete(cls.id, `${cls.program_name} Sem ${cls.semester}`)}
                                />
                            </td>
                        </tr>
                    )}
                />
            </div>

            <FormModal
                show={showModal}
                title={editItem ? "Edit Class & Sections" : "Add Class & Sections"}
                onClose={() => setShowModal(false)}
                onSubmit={handleSubmit(onSubmit)}
                isSubmitting={isSubmitting}
            >
                {/* Class Details */}
                <h6 className="fw-bold text-primary mb-3"><i className="bi bi-info-circle me-2"></i>Class Information</h6>

                <div className="row">
                    <div className="col-md-6 mb-3">
                        <label className="form-label fw-semibold small">Academic Session <span className="text-danger">*</span></label>
                        <select
                            className={`form-select ${errors.session_id ? 'is-invalid' : ''}`}
                            {...register('session_id', { required: 'Session is required' })}
                        >
                            <option value="">Select Session...</option>
                            {sessions.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                        {errors.session_id && <div className="invalid-feedback">{errors.session_id.message}</div>}
                    </div>
                    {isDeptAdmin ? null : (
                        <div className="col-md-6 mb-3">
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
                </div>

                <div className="row mb-4">
                    <div className="col-md-8 mb-3">
                        <label className="form-label fw-semibold small">Program Name <span className="text-danger">*</span></label>
                        <input
                            type="text"
                            className={`form-control ${errors.program_name ? 'is-invalid' : ''}`}
                            placeholder="e.g., BTech CSE (AI/DS)"
                            {...register('program_name', { required: 'Program name is required' })}
                        />
                        {errors.program_name && <div className="invalid-feedback">{errors.program_name.message}</div>}
                    </div>
                    <div className="col-md-4 mb-3">
                        <label className="form-label fw-semibold small">Semester <span className="text-danger">*</span></label>
                        <select
                            className={`form-select ${errors.semester ? 'is-invalid' : ''}`}
                            {...register('semester', { required: 'Semester is required' })}
                        >
                            <option value="">Select...</option>
                            {availableSemesters.map(s => (
                                <option key={s} value={s}>Semester {s}</option>
                            ))}
                        </select>
                        {errors.semester && <div className="invalid-feedback">{errors.semester.message}</div>}
                    </div>
                </div>

                <div className="row mb-4">
                    <div className="col-6">
                        <div className="form-check form-switch bg-light p-3 rounded-3 border">
                            <input
                                className="form-check-input ms-0 me-3"
                                type="checkbox"
                                role="switch"
                                id="is_active"
                                {...register('is_active')}
                                style={{ transform: 'scale(1.2)' }}
                            />
                            <label className="form-check-label fw-bold text-dark" htmlFor="is_active" style={{ cursor: 'pointer' }}>
                                Class is Active
                                {/* <div className="fw-normal text-muted small mt-1">Inactive classes will not appear in timetable views or be assigned new rooms.</div> */}
                            </label>
                        </div>
                    </div>
                </div>

                {/* Electives */}
                {availableElectives.length > 0 && (
                    <div className="mb-4">
                        <h6 className="fw-bold text-warning mb-2"><i className="bi bi-star me-2"></i>Available Elective Subjects</h6>
                        <div className="d-flex flex-wrap gap-2">
                            {availableElectives.map(subject => (
                                <button
                                    key={subject.id}
                                    type="button"
                                    onClick={() => toggleElective(subject.id)}
                                    className={`btn btn-sm rounded-pill border ${selectedElectives.includes(subject.id) ? 'btn-success text-white border-success' : 'btn-light text-muted'}`}
                                >
                                    {selectedElectives.includes(subject.id) && <i className="bi bi-check2 me-1"></i>}
                                    {subject.full_name} ({subject.short_code}) - <small className="opacity-75">{subject.type || (subject.subject_type === 'lab' ? 'Lab' : 'Theory')}</small>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Sections */}
                <div className="d-flex justify-content-between align-items-center mb-3 border-top pt-4">
                    <h6 className="fw-bold text-primary mb-0"><i className="bi bi-people me-2"></i>Sections</h6>
                    <button
                        type="button"
                        className="btn btn-sm btn-outline-primary rounded-pill"
                        onClick={() => append({ section_name: '', student_strength: 0, home_room_id: '', mode: 'Offline' })}
                    >
                        <i className="bi bi-plus-lg me-1"></i> Add Section
                    </button>
                </div>

                <div className="alert alert-info py-2 small mb-3 d-flex align-items-start gap-2 border-0 bg-primary bg-opacity-10 text-primary-emphasis">
                    <i className="bi bi-info-circle-fill mt-1"></i>
                    <div>
                        <strong>Section Naming Rule:</strong> If this class has only <strong>1 Section</strong>, name it <strong>A</strong> (it will be hidden in Timetable Views automatically). If there are multiple sections, name them <strong>B1, B2, B3</strong> etc.
                    </div>
                </div>

                {fields.map((item, index) => (
                    <div key={item.id} className="row g-2 align-items-end mb-3 bg-light p-2 rounded-3">
                        <div className="col-md-3">
                            <label className="form-label fw-semibold small mb-1">Section Name <span className="text-danger">*</span></label>
                            <input
                                type="text"
                                className={`form-control form-control-sm ${errors.sections?.[index]?.section_name ? 'is-invalid' : ''}`}
                                placeholder="e.g., A, B, B1"
                                {...register(`sections.${index}.section_name`, { required: 'Required' })}
                            />
                        </div>
                        <div className="col-md-2">
                            <label className="form-label fw-semibold small mb-1">Strength</label>
                            <input
                                type="number"
                                className="form-control form-control-sm"
                                placeholder="e.g., 60"
                                {...register(`sections.${index}.student_strength`)}
                            />
                        </div>
                        <div className="col-md-3">
                            <label className="form-label fw-semibold small mb-1">Mode</label>
                            <select
                                className="form-select form-select-sm"
                                {...register(`sections.${index}.mode`)}
                            >
                                <option value="Offline">Offline</option>
                                <option value="Online">Online</option>
                            </select>
                        </div>
                        <div className="col-md-3">
                            <label className="form-label fw-semibold small mb-1">Home Room</label>
                            <select
                                className="form-select form-select-sm bg-light"
                                disabled
                                {...register(`sections.${index}.home_room_id`)}
                            >
                                <option value="">Not Allocated</option>
                                {rooms.map(room => (
                                    <option key={room.id} value={room.id}>{room.room_number} {room.building && `(${room.building})`}</option>
                                ))}
                            </select>
                        </div>
                        <div className="col-md-1 text-end">
                            <button
                                type="button"
                                className="btn btn-sm btn-light text-danger rounded-circle border mb-1"
                                onClick={() => remove(index)}
                                disabled={fields.length === 1}
                            >
                                <i className="bi bi-trash"></i>
                            </button>
                        </div>
                    </div>
                ))}
            </FormModal>

            {/* Bulk Upload Modal */}
            <FormModal
                show={showBulkUpload}
                title="Bulk Upload Classes"
                onClose={() => setShowBulkUpload(false)}
                onSubmit={handleBulkUpload}
                isSubmitting={isUploading}
                submitText="Upload"
            >
                <div className="mb-4 text-center">
                    <i className="bi bi-file-earmark-spreadsheet text-success mb-2" style={{ fontSize: '3rem' }}></i>
                    <h5 className="fw-bold text-dark mt-2">Download Template</h5>
                    <p className="text-muted small mb-3">Please use the standard Excel/CSV template for bulk uploading classes.</p>
                    <a href="/templates/class_upload_template.csv" download className="btn btn-sm btn-outline-success rounded-pill px-4">
                        <i className="bi bi-download me-2"></i> Download Template
                    </a>
                </div>

                <div className="alert alert-info py-2 small mb-4 d-flex align-items-start gap-2 border-0 bg-primary bg-opacity-10 text-primary-emphasis">
                    <i className="bi bi-info-circle-fill mt-1"></i>
                    <div>
                        <strong>Section Naming Rule:</strong> In your Excel/CSV, if a class has only <strong>1 Section</strong>, please name it <strong>A</strong> (it will be hidden in Timetable Views). If multiple sections exist, use <strong>B1, B2, B3</strong> etc.
                    </div>
                </div>

                <div className="mb-4">
                    <label className="form-label fw-bold text-dark">Upload Excel/CSV File <span className="text-danger">*</span></label>
                    <input
                        type="file"
                        className="form-control bg-light"
                        accept=".csv, .xlsx, .xls"
                        onChange={(e) => setBulkFile(e.target.files[0])}
                        required
                    />
                </div>

                {bulkSummary && (
                    <div className="alert alert-info py-2 small mb-3 border-0 shadow-sm">
                        <i className="bi bi-info-circle-fill me-2"></i>
                        Upload complete.
                        Added: <span className="fw-bold">{bulkSummary.inserted}</span>,
                        Skipped: <span className="fw-bold">{bulkSummary.skipped}</span>,
                        Errors: <span className="fw-bold">{bulkSummary.errors}</span>
                    </div>
                )}

                {bulkErrors && (
                    <div className="alert alert-danger p-0 overflow-hidden shadow-sm border-0 mt-3 rounded-3">
                        <div className="bg-danger bg-opacity-10 px-3 py-2 border-bottom border-danger border-opacity-25 fw-bold text-danger small">
                            <i className="bi bi-exclamation-octagon-fill me-2"></i> Errors found:
                        </div>
                        <ul className="list-group list-group-flush small" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                            {bulkErrors.map((err, i) => (
                                <li key={i} className="list-group-item bg-transparent text-danger py-1 px-3 border-0">{err}</li>
                            ))}
                        </ul>
                    </div>
                )}
            </FormModal>

            <MergeSectionsModal
                show={showMergeGroups}
                onClose={() => {
                    setShowMergeGroups(false);
                    fetchClasses(); // Refresh classes to see updated merge_group_ids if needed
                }}
                initialDepartmentId={deptFilter}
            />
        </div>
    );
};

export default Classes;
