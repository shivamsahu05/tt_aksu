import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import { toast } from 'react-toastify';
import { safeDelete, showSuccess } from '../../utils/alerts';
import FormModal from '../../components/common/FormModal';
import PageHeader from '../../components/common/PageHeader';
import DataTable from '../../components/common/DataTable';
import StatusBadge from '../../components/common/StatusBadge';
import ActionButtons from '../../components/common/ActionButtons';
import { useForm } from 'react-hook-form';
import { useAuth } from '../../context/AuthContext';
import Swal from 'sweetalert2';
import { exportToExcel } from '../../utils/exportToExcel';

const Teachers = () => {
    const { user } = useAuth();
    const isDeptAdmin = user?.role === 'DEPARTMENT_ADMIN';
    const [teachers, setTeachers] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [teacherStats, setTeacherStats] = useState({ total_university: 0, primary_count: 0, secondary_count: 0, active_count: 0, inactive_count: 0 });

    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [deptFilter, setDeptFilter] = useState('');

    // Pagination
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);

    const [showModal, setShowModal] = useState(false);
    const [editItem, setEditItem] = useState(null);

    // View Modal
    const [showViewModal, setShowViewModal] = useState(false);
    const [viewItem, setViewItem] = useState(null);

    // Bulk Upload
    const [showBulkUpload, setShowBulkUpload] = useState(false);
    const [bulkFile, setBulkFile] = useState(null);
    const [bulkErrors, setBulkErrors] = useState(null);
    const [bulkSuccess, setBulkSuccess] = useState(null);

    // Stats Modal State
    const [statsModal, setStatsModal] = useState({ show: false, title: '', type: '', data: [] });
    const [loadingStatsModal, setLoadingStatsModal] = useState(false);

    const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm();
    const primaryDeptId = watch('department_id');

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

    const fetchStats = async () => {
        try {
            let url = '/teachers/stats';
            if (deptFilter) url += `?department_id=${deptFilter}`;
            const res = await api.get(url);
            if (res.data.success) {
                setTeacherStats(res.data.data);
            }
        } catch (error) {
            console.error('Failed to fetch teacher stats');
        }
    };

    const fetchTeachers = async () => {
        try {
            setLoading(true);
            let url = `/teachers?page=${page}&limit=10&search=${searchTerm}`;
            if (deptFilter) url += `&department_id=${deptFilter}`;

            const res = await api.get(url);
            if (res.data.success) {
                setTeachers(res.data.data);
                setTotalPages(res.data.pagination.totalPages);
            }
            fetchStats();
        } catch (error) {
            toast.error('Failed to fetch teachers');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDepartments();
    }, []);

    useEffect(() => {
        fetchTeachers();
    }, [page, searchTerm, deptFilter]);

    const handleSearch = (e) => {
        setSearchTerm(e.target.value);
        setPage(1);
    };

    const openStatsModal = async (type) => {
        try {
            setLoadingStatsModal(true);
            
            let title = '';
            if (type === 'primary') title = 'Primary Department Teachers';
            else if (type === 'secondary') title = 'Secondary Department Teachers';
            else if (type === 'free') title = 'Free Teachers (No Subjects Assigned)';
            
            setStatsModal({ show: true, title, type, data: [] });

            const params = { limit: 5000, page: 1 };
            if (deptFilter) {
                params.department_id = deptFilter;
            }
            if (type === 'free') {
                params.is_free = true;
            }

            const res = await api.get('/teachers', { params });
            const allTeachers = res.data?.data || [];

            let filteredData = [];
            if (type === 'primary') {
                if (deptFilter) {
                    filteredData = allTeachers.filter(t => t.department_id.toString() === deptFilter.toString());
                } else {
                    filteredData = allTeachers; // All are primary if no filter
                }
            } else if (type === 'secondary') {
                if (deptFilter) {
                    filteredData = allTeachers.filter(t => t.department_id.toString() !== deptFilter.toString());
                } else {
                    filteredData = allTeachers.filter(t => t.secondary_departments && t.secondary_departments !== '[]' && t.secondary_departments !== 'null' && t.secondary_departments !== '');
                }
            } else if (type === 'free') {
                filteredData = allTeachers;
            }

            setStatsModal(prev => ({ ...prev, data: filteredData }));
        } catch (error) {
            toast.error('Failed to fetch teachers for stats');
            setStatsModal(prev => ({ ...prev, show: false }));
        } finally {
            setLoadingStatsModal(false);
        }
    };

    const handleDeptFilter = (e) => {
        setDeptFilter(e.target.value);
        setPage(1);
    };

    const openAddModal = () => {
        setEditItem(null);
        reset({
            department_id: isDeptAdmin ? user.department_id : '',
            secondary_departments: [],
            full_name: '',
            short_name: '',
            designation: '',
            expertise: '',
            email: '',
            mobile: '',
            employee_code: '',
            is_active: true
        });
        setShowModal(true);
    };

    const openEditModal = (teacher) => {
        setEditItem(teacher);

        let secondary = [];
        if (teacher.secondary_departments) {
            try { secondary = JSON.parse(teacher.secondary_departments); } catch (e) { secondary = []; }
            if (!Array.isArray(secondary)) secondary = [];
        }

        reset({
            department_id: teacher.department_id,
            secondary_departments: secondary.map(id => id.toString()),
            full_name: teacher.full_name,
            short_name: teacher.short_name,
            designation: teacher.designation || '',
            expertise: teacher.expertise || '',
            email: teacher.email || '',
            mobile: teacher.mobile || '',
            employee_code: teacher.employee_code || '',
            is_active: teacher.is_active === 1
        });
        setShowModal(true);
    };

    const openViewModal = (teacher) => {
        setViewItem(teacher);
        setShowViewModal(true);
    };

    const handleDownloadTemplate = () => {
        const csvContent = "data:text/csv;charset=utf-8,Name,Employee ID,Department,Designation,Expertise,Mobile,Short Name\nExample Name,EMP001,Computer Science,Professor,Networking,9876543210,EX";
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "teacher_upload_template.csv");
        document.body.appendChild(link);
        link.click();
        link.remove();
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
            const res = await api.post('/teachers/bulk', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            if (res.data.success) {
                setBulkSuccess(res.data.message);
                if (res.data.errors) {
                    setBulkErrors(res.data.errors);
                }
                fetchTeachers();
            }
        } catch (error) {
            toast.error(error.response?.data?.message || "Failed to upload file");
        }
    };

    const handleExportExcel = async () => {
        const result = await Swal.fire({
            title: 'Export Teachers',
            text: 'Do you want to include teachers who have this department as their secondary department?',
            icon: 'question',
            showDenyButton: true,
            showCancelButton: true,
            confirmButtonText: 'Yes, Include',
            denyButtonText: 'Primary Only',
            cancelButtonText: 'Cancel'
        });

        if (result.isDismissed) return;
        const includeSecondary = result.isConfirmed; // true if yes, false if denied (Primary only)

        try {
            const toastId = toast.loading('Fetching all teachers for export...');

            const params = {
                limit: 5000,
                page: 1,
                search: searchTerm,
                exclude_secondary: !includeSecondary
            };
            if (deptFilter) {
                params.department_id = deptFilter;
            }

            const res = await api.get('/teachers', { params });
            const allTeachers = res.data?.data || [];

            toast.dismiss(toastId);

            if (allTeachers.length === 0) {
                return toast.warning('No teachers found to export.');
            }

            const currentDate = new Date().toISOString().split('T')[0];
            const deptName = deptFilter ? (departments.find(d => d.id.toString() === deptFilter.toString())?.name || 'Department') : 'All_Departments';

            exportToExcel({
                filename: `Teachers_${deptName.replace(/\s+/g, '_')}_${currentDate}`,
                sheetName: 'Teachers',
                columns: [
                    { header: 'Full Name', key: 'full_name' },
                    { header: 'Short Name', key: 'short_name' },
                    { header: 'Employee Code', key: 'employee_code' },
                    { header: 'Primary Dept', key: 'department_name' },
                    {
                        header: 'Secondary Depts', key: row => {
                            if (!row.secondary_departments) return '-';
                            try {
                                const ids = JSON.parse(row.secondary_departments);
                                if (!Array.isArray(ids) || ids.length === 0) return '-';
                                return departments
                                    .filter(d => ids.includes(d.id.toString()) || ids.includes(d.id))
                                    .map(d => d.name)
                                    .join(', ');
                            } catch (e) {
                                return '-';
                            }
                        }
                    },
                    { header: 'Designation', key: 'designation' },
                    { header: 'Mobile', key: 'mobile' },
                    { header: 'Email', key: 'email' },
                    { header: 'Status', key: row => row.is_active ? 'Active' : 'Inactive' },
                ],
                data: allTeachers,
                notes: [
                    'Included: Full Name, Short Name, Employee Code, Primary Dept, Secondary Depts, Designation, Mobile, Email, Status',
                    'Excluded: Profile Photo, Password/Login credentials, Timetable Assignments',
                    `Export Date: ${currentDate}`,
                    `Filters - Department: ${deptName} | Included Secondary Depts: ${includeSecondary ? 'Yes' : 'No'} | Search: ${searchTerm || 'None'}`,
                ],
            });
        } catch (error) {
            console.error('Export error:', error);
            toast.dismiss();
            toast.error('Failed to export teachers');
        }
    };

    const onSubmit = async (data) => {
        try {
            const formData = new FormData();
            if (isDeptAdmin) {
                formData.append('department_id', user.department_id);
            } else if (data.department_id) {
                formData.append('department_id', data.department_id);
            }
            formData.append('full_name', data.full_name);
            formData.append('short_name', data.short_name);
            if (data.designation) formData.append('designation', data.designation);
            if (data.expertise) formData.append('expertise', data.expertise);
            if (data.email) formData.append('email', data.email);
            if (data.mobile) formData.append('mobile', data.mobile);
            if (data.employee_code) formData.append('employee_code', data.employee_code);
            formData.append('is_active', data.is_active ? 1 : 0);

            if (data.secondary_departments && data.secondary_departments.length > 0) {
                formData.append('secondary_departments', JSON.stringify(data.secondary_departments));
            }

            if (editItem) {
                await api.put(`/teachers/${editItem.id}`, formData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });
                showSuccess('Teacher updated successfully');
            } else {
                await api.post('/teachers', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });
                showSuccess('Teacher added successfully');
            }
            setShowModal(false);
            fetchTeachers();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Operation failed');
        }
    };

    const handleDelete = (id, name) => {
        safeDelete(name, async () => {
            try {
                await api.delete(`/teachers/${id}`);
                showSuccess('Teacher deleted successfully');
                fetchTeachers();
            } catch (error) {
                toast.error(error.response?.data?.message || 'Failed to delete teacher');
            }
        });
    };

    const handleDeleteByDepartment = async () => {
        // Build checkboxes HTML for each department
        const deptOptions = departments.map(d =>
            `<div class="form-check text-start mb-1">
                <input class="form-check-input dept-check" type="checkbox" value="${d.id}" id="dept-${d.id}">
                <label class="form-check-label small" for="dept-${d.id}">${d.name} <span class="text-muted">(${d.short_code})</span></label>
            </div>`
        ).join('');

        const { isConfirmed, value: selectedIds } = await Swal.fire({
            title: '<span style="color:#dc3545"><i class="bi bi-trash3-fill me-2"></i>Delete Teachers by Department</span>',
            html: `
                <p class="text-muted small mb-3">Select one or more departments. <strong>All teachers</strong> in those departments will be permanently deleted along with their allocations and timetable entries.</p>
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

        // Second confirmation
        const selectedNames = departments
            .filter(d => selectedIds.includes(d.id))
            .map(d => d.name)
            .join(', ');

        const { isConfirmed: finalConfirm } = await Swal.fire({
            title: 'Are you absolutely sure?',
            html: `<p class="mb-2">This will <strong>permanently delete ALL teachers</strong> from:</p><p class="fw-bold text-danger">${selectedNames}</p><p class="text-muted small">This action <strong>cannot be undone</strong>. Related timetable entries and allocations will also be removed.</p>`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Yes, Delete Permanently',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#dc3545',
            cancelButtonColor: '#64748b',
        });

        if (!finalConfirm) return;

        try {
            const res = await api.delete('/teachers/bulk-by-department', { data: { department_ids: selectedIds } });
            if (res.data.success) {
                Swal.fire('Deleted!', res.data.message, 'success');
                fetchTeachers();
            }
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to delete teachers');
        }
    };

    const columns = [
        { label: 'Profile', className: 'ps-4' },
        { label: 'Teacher Info' },
        { label: 'Department' },
        { label: 'Contact' },
        { label: 'Status' },
        { label: 'Actions', className: 'text-end pe-4' }
    ];

    return (
        <div>
            <PageHeader
                title="Faculty Members"
                subtitle="Manage teachers and their profiles"
                icon="bi-people"
                actionButton={{ label: "Add Teacher", icon: "bi-plus-lg", onClick: openAddModal }}
            />

            {/* Overview Stats Section */}
            <div className="row g-3 mb-4">
                <div className="col-12 col-sm-6 col-xl">
                    <div className="card border-0 shadow-sm rounded-4 h-100 bg-white">
                        <div className="card-body p-3 d-flex align-items-center">
                            <div className="bg-primary bg-opacity-10 rounded-circle p-3 d-flex align-items-center justify-content-center me-3 text-primary" style={{ width: '48px', height: '48px' }}>
                                <i className="bi bi-building fs-4"></i>
                            </div>
                            <div>
                                <p className="mb-0 text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Total Teachers</p>
                                <h3 className="mb-0 fw-bold text-dark">{teacherStats.total_university || 0}</h3>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="col-12 col-sm-6 col-xl">
                    <div className="card border-0 shadow-sm rounded-4 h-100 bg-white" style={{ cursor: 'pointer' }} onClick={() => openStatsModal('primary')}>
                        <div className="card-body p-3 d-flex align-items-center hover-lift transition-all">
                            <div className="bg-success bg-opacity-10 rounded-circle p-3 d-flex align-items-center justify-content-center me-3 text-success" style={{ width: '48px', height: '48px' }}>
                                <i className="bi bi-person-badge fs-4"></i>
                            </div>
                            <div>
                                <p className="mb-0 text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Primary Dept</p>
                                <h3 className="mb-0 fw-bold text-dark">{teacherStats.primary_count || 0}</h3>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="col-12 col-sm-6 col-xl">
                    <div className="card border-0 shadow-sm rounded-4 h-100 bg-white" style={{ cursor: 'pointer' }} onClick={() => openStatsModal('secondary')}>
                        <div className="card-body p-3 d-flex align-items-center hover-lift transition-all">
                            <div className="bg-info bg-opacity-10 rounded-circle p-3 d-flex align-items-center justify-content-center me-3 text-info" style={{ width: '48px', height: '48px' }}>
                                <i className="bi bi-diagram-2 fs-4"></i>
                            </div>
                            <div>
                                <p className="mb-0 text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Secondary Depts</p>
                                <h3 className="mb-0 fw-bold text-dark">{teacherStats.secondary_count || 0}</h3>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="col-12 col-sm-6 col-xl">
                    <div className="card border-0 shadow-sm rounded-4 h-100 bg-white" style={{ cursor: 'pointer' }} onClick={() => openStatsModal('free')}>
                        <div className="card-body p-3 d-flex align-items-center hover-lift transition-all">
                            <div className="bg-warning bg-opacity-10 rounded-circle p-3 d-flex align-items-center justify-content-center me-3 text-warning" style={{ width: '48px', height: '48px' }}>
                                <i className="bi bi-cup-hot fs-4"></i>
                            </div>
                            <div>
                                <p className="mb-0 text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Free Teachers</p>
                                <h3 className="mb-0 fw-bold text-dark">{teacherStats.free_count || 0}</h3>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="col-12 col-xl-3">
                    <div className="card border-0 shadow-sm rounded-4 h-100 bg-white">
                        <div className="card-body p-2 p-md-3 d-flex align-items-center justify-content-around">
                            <div className="d-flex align-items-center">
                                <div className="bg-success bg-opacity-10 rounded-circle p-2 d-flex align-items-center justify-content-center me-2 text-success" style={{ width: '42px', height: '42px' }}>
                                    <i className="bi bi-person-check-fill fs-5"></i>
                                </div>
                                <div>
                                    <p className="mb-0 text-muted" style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Active</p>
                                    <h4 className="mb-0 fw-bold text-dark">{teacherStats.active_count || 0}</h4>
                                </div>
                            </div>
                            <div style={{ width: '1px', height: '40px', backgroundColor: '#e2e8f0' }}></div>
                            <div className="d-flex align-items-center">
                                <div className="bg-danger bg-opacity-10 rounded-circle p-2 d-flex align-items-center justify-content-center me-2 text-danger" style={{ width: '42px', height: '42px' }}>
                                    <i className="bi bi-person-dash-fill fs-5"></i>
                                </div>
                                <div>
                                    <p className="mb-0 text-muted" style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Inactive</p>
                                    <h4 className="mb-0 fw-bold text-dark">{teacherStats.inactive_count || 0}</h4>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="d-flex flex-wrap justify-content-start justify-content-sm-end mb-3 px-2 gap-2">
                <button
                    onClick={handleDeleteByDepartment}
                    className="btn btn-sm btn-outline-danger rounded-pill shadow-sm d-inline-flex align-items-center justify-content-center text-nowrap"
                    title="Delete all teachers from selected departments"
                >
                    <i className="bi bi-trash3-fill me-1"></i>
                    <span className="d-none d-sm-inline">Delete by Department</span>
                    <span className="d-sm-none">Delete</span>
                </button>
                <button
                    onClick={handleExportExcel}
                    className="btn btn-sm btn-outline-success rounded-pill shadow-sm d-inline-flex align-items-center justify-content-center text-nowrap"
                >
                    <i className="bi bi-file-earmark-excel me-1"></i>
                    <span className="d-none d-sm-inline">Export Excel</span>
                    <span className="d-sm-none">Excel</span>
                </button>
                <button onClick={() => { setBulkFile(null); setBulkErrors(null); setBulkSuccess(null); setShowBulkUpload(true); }} className="btn btn-sm btn-primary rounded-pill shadow-sm d-inline-flex align-items-center justify-content-center text-nowrap">
                    <i className="bi bi-cloud-upload me-1"></i>
                    <span className="d-none d-sm-inline">Bulk Upload Teachers</span>
                    <span className="d-sm-none">Bulk Upload</span>
                </button>
            </div>

            <div className="card border-0 shadow-sm rounded-4">
                <div className="card-header border-bottom-0 py-3 d-flex flex-wrap justify-content-between align-items-center gap-3" style={{ background: 'var(--card-bg)' }}>
                    <div className="input-group w-auto flex-grow-1" style={{ maxWidth: '400px' }}>
                        <span className="input-group-text bg-light border-end-0 rounded-start-pill">
                            <i className="bi bi-search text-muted"></i>
                        </span>
                        <input
                            type="text"
                            className="form-control bg-light border-start-0 rounded-end-pill"
                            placeholder="Search by name, short name, or emp code..."
                            value={searchTerm}
                            onChange={handleSearch}
                        />
                    </div>
                    <div className="w-auto">
                        <select className="form-select bg-light rounded-pill border-0 px-4" value={deptFilter} onChange={handleDeptFilter}>
                            <option value="">All Departments</option>
                            {departments.map(dept => (
                                <option key={dept.id} value={dept.id}>{dept.name} ({dept.short_code})</option>
                            ))}
                        </select>
                    </div>
                </div>

                <DataTable
                    columns={columns}
                    data={teachers}
                    loading={loading}
                    page={page}
                    totalPages={totalPages}
                    setPage={setPage}
                    emptyMessage="No teachers found."
                    emptyIcon="bi-person-x"
                    renderRow={(teacher) => (
                        <tr key={teacher.id}>
                            <td className="ps-4">
                                {teacher.photo ? (
                                    <img src={`http://localhost:5000${teacher.photo}`} alt={teacher.full_name} className="rounded-circle object-fit-cover border shadow-sm" style={{ width: '45px', height: '45px' }} />
                                ) : (
                                    <div className="rounded-circle bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center fw-bold border shadow-sm" style={{ width: '45px', height: '45px' }}>
                                        {teacher.full_name.charAt(0)}
                                    </div>
                                )}
                            </td>
                            <td>
                                <div className="fw-bold text-dark">{teacher.full_name} <span className="badge bg-light text-secondary border ms-1">{teacher.short_name}</span></div>
                                <div className="small text-muted">{teacher.designation || 'Faculty'} {teacher.employee_code && `| Emp: ${teacher.employee_code}`}</div>
                            </td>
                            <td>
                                <div className="fw-medium text-dark" title={teacher.department_name}>{teacher.department_code || teacher.department_name}</div>
                            </td>
                            <td>
                                {teacher.mobile ? <div className="small text-muted"><i className="bi bi-telephone me-1"></i> {teacher.mobile}</div> : <span className="small text-muted fst-italic">No contact info</span>}
                            </td>
                            <td><StatusBadge active={teacher.is_active} /></td>
                            <td className="pe-4">
                                <ActionButtons
                                    onView={() => openViewModal(teacher)}
                                    onEdit={() => openEditModal(teacher)}
                                    onDelete={() => handleDelete(teacher.id, teacher.full_name)}
                                />
                            </td>
                        </tr>
                    )}
                />
            </div>

            <FormModal
                show={showModal}
                title={editItem ? "Edit Teacher" : "Add Teacher"}
                onClose={() => setShowModal(false)}
                onSubmit={handleSubmit(onSubmit)}
                isSubmitting={isSubmitting}
            >
                <div>
                    <div className="row">
                        <div className="col-md-12 mb-3">
                            <label className="form-label fw-semibold small">Full Name <span className="text-danger">*</span></label>
                            <input
                                type="text"
                                className={`form-control ${errors.full_name ? 'is-invalid' : ''}`}
                                placeholder="e.g., Dr. John Doe"
                                {...register('full_name', { required: 'Full name is required' })}
                            />
                            {errors.full_name && <div className="invalid-feedback">{errors.full_name.message}</div>}
                        </div>
                    </div>

                    <div className="row">
                        <div className="col-md-6 mb-3">
                            <label className="form-label fw-semibold small">Short Name <span className="text-danger">*</span></label>
                            <input
                                type="text"
                                className={`form-control ${errors.short_name ? 'is-invalid' : ''}`}
                                placeholder="e.g., J.D."
                                {...register('short_name', { required: 'Short name is required' })}
                            />
                            {errors.short_name && <div className="invalid-feedback">{errors.short_name.message}</div>}
                        </div>
                        <div className="col-md-6 mb-3">
                            <label className="form-label fw-semibold small">Primary Department <span className="text-danger">*</span></label>
                            <select
                                className={`form-select ${errors.department_id ? 'is-invalid' : ''}`}
                                {...register('department_id', { required: 'Department is required' })}
                                disabled={isDeptAdmin}
                            >
                                <option value="">Select Department...</option>
                                {departments.map(dept => (
                                    <option key={dept.id} value={dept.id}>{dept.name} ({dept.short_code})</option>
                                ))}
                            </select>
                            {errors.department_id && <div className="invalid-feedback">{errors.department_id.message}</div>}
                        </div>
                    </div>

                    <div className="row">
                        <div className="col-md-6 mb-3">
                            <label className="form-label fw-semibold small">Secondary Departments</label>
                            <div style={{ maxHeight: '190px', overflowY: 'auto', border: '1px solid var(--app-border)', borderRadius: 'var(--radius-md)', padding: '10px' }} className="bg-white">
                                {departments.filter(dept => dept.id.toString() !== primaryDeptId?.toString()).map(dept => (
                                    <div key={dept.id} className="form-check mb-1">
                                        <input
                                            className="form-check-input"
                                            type="checkbox"
                                            value={dept.id}
                                            id={`sec-dept-${dept.id}`}
                                            {...register('secondary_departments')}
                                        />
                                        <label className="form-check-label small" htmlFor={`sec-dept-${dept.id}`}>
                                            {dept.name} ({dept.short_code})
                                        </label>
                                    </div>
                                ))}
                            </div>
                            <div className="form-text small mt-1">Select other departments where this teacher teaches.</div>
                            
                            <div className="mt-3">
                                <label className="form-label fw-semibold small">Expertise</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    placeholder="e.g., Computer Networks, Database Systems"
                                    {...register('expertise')}
                                />
                            </div>
                        </div>
                        <div className="col-md-6">
                            <div className="mb-3">
                                <label className="form-label fw-semibold small">Designation</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    placeholder="e.g., Assistant Professor"
                                    {...register('designation')}
                                />
                            </div>
                            <div className="mb-3">
                                <label className="form-label fw-semibold small">Employee Code <span className="text-danger">*</span></label>
                                <input
                                    type="text"
                                    className={`form-control ${errors.employee_code ? 'is-invalid' : ''}`}
                                    placeholder="e.g., EMP1024"
                                    {...register('employee_code', { required: 'Employee Code is required' })}
                                />
                                {errors.employee_code && <div className="invalid-feedback">{errors.employee_code.message}</div>}
                            </div>
                            <div className="mb-3">
                                <label className="form-label fw-semibold small">Mobile Number</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    placeholder="e.g., +1234567890"
                                    {...register('mobile')}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="row">
                        <div className="col-md-12">
                            <div className="card bg-light border-0 rounded-4 mt-1">
                                <div className="card-body py-3">
                                    <div className="form-check form-switch mb-0 d-flex align-items-center gap-2">
                                        <input
                                            className="form-check-input m-0"
                                            type="checkbox"
                                            id="isActiveTeacherSwitch"
                                            {...register('is_active')}
                                        />
                                        <label className="form-check-label fw-semibold small m-0" htmlFor="isActiveTeacherSwitch">Active Faculty Member</label>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </FormModal>

            {/* View Modal */}
            <div className={`modal fade ${showViewModal ? 'show d-block' : ''}`} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex="-1">
                <div className="modal-dialog modal-dialog-centered">
                    <div className="modal-content border-0 shadow">
                        <div className="modal-header border-bottom-0 pb-0">
                            <h5 className="modal-title fw-bold">Teacher Details</h5>
                            <button type="button" className="btn-close" onClick={() => setShowViewModal(false)}></button>
                        </div>
                        <div className="modal-body">
                            {viewItem && (
                                <div className="text-center">
                                    {viewItem.photo ? (
                                        <img src={`http://localhost:5000${viewItem.photo}`} alt={viewItem.full_name} className="rounded-circle object-fit-cover shadow-sm mb-3" style={{ width: '100px', height: '100px' }} />
                                    ) : (
                                        <div className="rounded-circle bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center fw-bold shadow-sm mb-3 mx-auto" style={{ width: '100px', height: '100px', fontSize: '2rem' }}>
                                            {viewItem.full_name.charAt(0)}
                                        </div>
                                    )}
                                    <h4 className="fw-bold mb-1">{viewItem.full_name}</h4>
                                    <p className="text-muted mb-3">{viewItem.designation || 'Faculty'} | {viewItem.department_name}</p>

                                    <ul className="list-group list-group-flush text-start mt-4">
                                        <li className="list-group-item d-flex justify-content-between align-items-center px-0">
                                            <span className="text-muted"><i className="bi bi-person-badge me-2"></i>Employee ID</span>
                                            <span className="fw-medium">{viewItem.employee_code || '-'}</span>
                                        </li>
                                        {(() => {
                                            let secDepts = [];
                                            if (viewItem.secondary_departments) {
                                                try {
                                                    const ids = JSON.parse(viewItem.secondary_departments);
                                                    secDepts = departments.filter(d => ids.includes(d.id.toString()) || ids.includes(d.id));
                                                } catch (e) { }
                                            }
                                            if (secDepts.length > 0) {
                                                return (
                                                    <li className="list-group-item d-flex justify-content-between align-items-start px-0 py-2">
                                                        <span className="text-muted"><i className="bi bi-diagram-2 me-2"></i>Secondary Depts</span>
                                                        <div className="text-end" style={{ maxWidth: '65%' }}>
                                                            {secDepts.map(d => <span key={d.id} className="badge bg-light text-dark border ms-1 mb-1 text-wrap text-start">{d.name} ({d.short_code})</span>)}
                                                        </div>
                                                    </li>
                                                );
                                            }
                                            return null;
                                        })()}
                                        <li className="list-group-item d-flex justify-content-between align-items-center px-0">
                                            <span className="text-muted"><i className="bi bi-telephone me-2"></i>Mobile</span>
                                            <span className="fw-medium">{viewItem.mobile || '-'}</span>
                                        </li>
                                        <li className="list-group-item d-flex justify-content-between align-items-center px-0">
                                            <span className="text-muted"><i className="bi bi-tag me-2"></i>Short Name</span>
                                            <span className="fw-medium">{viewItem.short_name}</span>
                                        </li>
                                        <li className="list-group-item d-flex justify-content-between align-items-center px-0">
                                            <span className="text-muted"><i className="bi bi-activity me-2"></i>Status</span>
                                            <StatusBadge active={viewItem.is_active} />
                                        </li>
                                    </ul>
                                </div>
                            )}
                        </div>
                        <div className="modal-footer border-top-0 pt-0">
                            <button type="button" className="btn btn-light w-100 rounded-pill" onClick={() => setShowViewModal(false)}>Close</button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Bulk Upload Modal */}
            <div className={`modal fade ${showBulkUpload ? 'show d-block' : ''}`} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex="-1">
                <div className="modal-dialog modal-dialog-centered">
                    <div className="modal-content border-0 shadow">
                        <div className="modal-header border-bottom-0">
                            <h5 className="modal-title fw-bold">Bulk Upload Teachers</h5>
                            <button type="button" className="btn-close" onClick={() => setShowBulkUpload(false)}></button>
                        </div>
                        <div className="modal-body pb-0">
                            <div className="alert alert-info border-0 rounded-4 mb-4">
                                <div className="d-flex">
                                    <i className="bi bi-info-circle-fill fs-4 me-3"></i>
                                    <div>
                                        <h6 className="fw-bold mb-1">Download Template</h6>
                                        <p className="small mb-2">Please use the standard Excel/CSV template for bulk uploading teachers.</p>
                                        <p className="small mb-2 fw-medium text-primary">Note: The "Department" specified in the sheet will be assigned as the Primary Department. Secondary Departments must be manually added via the Edit feature after uploading.</p>
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

            {/* Stats Modal */}
            <FormModal
                show={statsModal.show}
                title={statsModal.title}
                onClose={() => setStatsModal({ show: false, title: '', type: '', data: [] })}
                hideFooter={true}
            >
                {loadingStatsModal ? (
                    <div className="text-center py-4">
                        <div className="spinner-border text-primary" role="status">
                            <span className="visually-hidden">Loading...</span>
                        </div>
                    </div>
                ) : (
                    <div className="table-responsive" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                        <table className="table table-hover table-sm align-middle" style={{ fontSize: '0.875rem' }}>
                            <thead className="table-light sticky-top">
                                <tr>
                                    <th style={{ width: '50px' }}>#</th>
                                    <th>Teacher Name</th>
                                    <th>Primary Dept</th>
                                    {statsModal.type === 'secondary' && <th>Secondary Dept(s)</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {statsModal.data.length > 0 ? statsModal.data.map((t, index) => {
                                    let secDeptsNames = '-';
                                    if (statsModal.type === 'secondary' && t.secondary_departments) {
                                        try {
                                            const ids = JSON.parse(t.secondary_departments);
                                            if (Array.isArray(ids) && ids.length > 0) {
                                                secDeptsNames = departments
                                                    .filter(d => ids.includes(d.id.toString()) || ids.includes(d.id))
                                                    .map(d => d.short_code || d.name)
                                                    .join(', ');
                                            }
                                        } catch(e) {}
                                    }
                                    return (
                                        <tr key={t.id}>
                                            <td className="text-muted">{index + 1}</td>
                                            <td>
                                                <div className="fw-semibold">{t.full_name}</div>
                                                {t.employee_code && <div className="text-muted small">{t.employee_code}</div>}
                                            </td>
                                            <td>{t.department_code || t.department_name}</td>
                                            {statsModal.type === 'secondary' && <td>{secDeptsNames}</td>}
                                        </tr>
                                    );
                                }) : (
                                    <tr>
                                        <td colSpan={statsModal.type === 'secondary' ? 4 : 3} className="text-center text-muted py-3">No teachers found</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </FormModal>
        </div>
    );
};

export default Teachers;
