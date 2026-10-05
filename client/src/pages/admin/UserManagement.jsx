import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import PageHeader from '../../components/common/PageHeader';
import DataTable from '../../components/common/DataTable';
import ActionButtons from '../../components/common/ActionButtons';
import FormModal from '../../components/common/FormModal';
import { toast } from 'react-toastify';
import Swal from 'sweetalert2';
import { useAuth } from '../../context/AuthContext';
import { exportToExcel } from '../../utils/exportToExcel';

const UserManagement = () => {
    const { user: currentUser } = useAuth();
    const [users, setUsers] = useState([]);
    const [page, setPage] = useState(1);
    const [searchTerm, setSearchTerm] = useState('');
    const [deptFilter, setDeptFilter] = useState('');
    const [roles] = useState([
        { id: 'SUPER_ADMIN', name: 'Super Admin' },
        { id: 'DEPARTMENT_ADMIN', name: 'Department Admin' },
        { id: 'FACULTY', name: 'Faculty' }
    ]);
    const [departments, setDepartments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isPwdModalOpen, setIsPwdModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [showPwd, setShowPwd] = useState(false);
    const [showResetPwd, setShowResetPwd] = useState(false);
    const [verifiedTeacher, setVerifiedTeacher] = useState(null);
    const [isVerifying, setIsVerifying] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = React.useRef(null);
    const [isPermModalOpen, setIsPermModalOpen] = useState(false);
    const [selectedUserPerms, setSelectedUserPerms] = useState([]);
    const [isAnalyseModalOpen, setIsAnalyseModalOpen] = useState(false);

    const [formData, setFormData] = useState({
        username: '',
        email: '',
        password: '',
        role: '',
        is_active: 1,
        department_id: '',
        mobile: '',
        employee_code: '',
        teacher_id: ''
    });

    const [pwdData, setPwdData] = useState({ new_password: '', employee_code: '' });

    const fetchData = async () => {
        try {
            setLoading(true);
            const [userRes, deptRes] = await Promise.all([
                api.get('/users'),
                api.get('/departments?limit=100')
            ]);
            setUsers(userRes.data.data);
            if (deptRes.data.success) {
                setDepartments(deptRes.data.data);
            }
        } catch (error) {
            toast.error('Failed to load users');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleAdd = () => {
        setEditingUser(null);
        setShowPwd(false);
        setFormData({
            username: '', email: '', password: '',
            role: currentUser.role === 'DEPARTMENT_ADMIN' ? 'FACULTY' : '',
            is_active: 1,
            department_id: currentUser.role === 'DEPARTMENT_ADMIN' ? currentUser.department_id : '',
            mobile: '', employee_code: '', teacher_id: ''
        });
        setVerifiedTeacher(null);
        setIsModalOpen(true);
    };

    const handleEdit = (user) => {
        setEditingUser(user);
        setFormData({
            username: user.username,
            email: user.email,
            password: '',
            role: user.role || '',
            is_active: user.is_active,
            department_id: user.department_id || '',
            mobile: user.mobile || '',
            employee_code: '',
            teacher_id: user.teacher_id || ''
        });
        if (user.teacher_id && user.teacher_name) {
            setVerifiedTeacher({ id: user.teacher_id, full_name: user.teacher_name, department_name: user.department_name });
        } else {
            setVerifiedTeacher(null);
        }
        setIsModalOpen(true);
    };

    const handlePwdChange = (user) => {
        setEditingUser(user);
        setPwdData({ new_password: '', employee_code: '' });
        setShowResetPwd(false);
        setIsPwdModalOpen(true);
    };

    const handleManagePermissions = (row) => {
        setEditingUser(row);
        let perms = row.permissions || [];
        if (typeof perms === 'string') {
            try { perms = JSON.parse(perms); } catch (e) { perms = []; }
        }
        setSelectedUserPerms(perms);
        setIsPermModalOpen(true);
    };

    const handlePermSubmit = async (e) => {
        e.preventDefault();
        try {
            await api.put(`/users/${editingUser.id}`, {
                email: editingUser.email,
                role: editingUser.role,
                is_active: editingUser.is_active,
                department_id: editingUser.department_id || null,
                mobile: editingUser.mobile || null,
                teacher_id: editingUser.teacher_id || null,
                permissions: selectedUserPerms
            });
            toast.success("Permissions updated");
            setIsPermModalOpen(false);
            fetchData();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to update permissions');
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm("Are you sure you want to delete this user?")) return;
        try {
            await api.delete(`/users/${id}`);
            toast.success("User deleted");
            fetchData();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Delete failed');
        }
    };

    const handleToggleBlock = async (user) => {
        const isBlocked = !user.is_active;
        const title = isBlocked ? 'Unblock User Account?' : 'Block User Account?';
        const text = isBlocked
            ? `Are you sure you want to unblock "${user.username}"? This will reset their failed login attempts to 0 and restore login access.`
            : `Are you sure you want to block "${user.username}"? They will not be able to log in.`;
        const confirmButtonText = isBlocked ? 'Yes, Unblock!' : 'Yes, Block!';
        const confirmButtonColor = isBlocked ? '#10b981' : '#ef4444';

        const res = await Swal.fire({
            title,
            text,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor,
            cancelButtonColor: '#6c757d',
            confirmButtonText,
            cancelButtonText: 'Cancel'
        });

        if (!res.isConfirmed) return;

        try {
            await api.put(`/users/${user.id}`, {
                email: user.email,
                role: user.role,
                is_active: isBlocked ? 1 : 0,
                department_id: user.department_id || null,
                mobile: user.mobile || null,
                teacher_id: user.teacher_id || null
            });
            toast.success(`User '${user.username}' has been ${isBlocked ? 'unblocked' : 'blocked'}!`);
            fetchData();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Action failed');
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.role) {
            toast.error("Please select a Role first!");
            return;
        }
        if (formData.role === 'FACULTY' && !formData.teacher_id) {
            toast.error("Please enter Employee ID and click Verify to verify the faculty first!");
            return;
        }
        if (!formData.username || !formData.email || (!editingUser && !formData.password)) {
            toast.error("Username, Email, and Password are all required!");
            return;
        }
        const duplicateUser = users.find(u => u.username.toLowerCase() === (formData.username || '').trim().toLowerCase() && (!editingUser || u.id !== editingUser.id));
        if (duplicateUser) {
            toast.error(`Username '${duplicateUser.username}' is already taken! Please choose a unique username.`);
            return;
        }
        try {
            if (editingUser) {
                await api.put(`/users/${editingUser.id}`, {
                    email: formData.email,
                    role: formData.role,
                    is_active: formData.is_active,
                    department_id: formData.department_id || null,
                    mobile: formData.mobile || null,
                    teacher_id: formData.teacher_id || null
                });
                toast.success("User updated");
            } else {
                await api.post('/users', {
                    ...formData,
                    department_id: formData.department_id || null,
                    mobile: formData.mobile || null,
                    teacher_id: formData.teacher_id || null
                });
                toast.success("User created");
            }
            setIsModalOpen(false);
            fetchData();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Save failed');
        }
    };

    const handleVerifyTeacher = async () => {
        if (!formData.employee_code) {
            toast.warning('Please enter an Employee ID');
            return;
        }
        setIsVerifying(true);
        try {
            const res = await api.get(`/teachers/verify/${formData.employee_code}`);
            if (res.data.success) {
                const teacher = res.data.data;
                const firstName = (teacher.full_name.split(' ')[0] || 'faculty').replace(/[^a-zA-Z]/g, '');
                const empDigits = (teacher.employee_code.replace(/[^0-9a-zA-Z]/g, '') || '001').slice(-3);
                const autoUsername = (firstName.toLowerCase() + empDigits).toLowerCase();
                const autoPassword = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase() + '@' + empDigits + '#';

                setVerifiedTeacher(teacher);
                setFormData(prev => ({
                    ...prev,
                    teacher_id: teacher.id,
                    department_id: teacher.department_id || prev.department_id,
                    username: autoUsername,
                    password: autoPassword,
                    email: teacher.email || prev.email || '',
                    mobile: teacher.mobile || prev.mobile || ''
                }));
                toast.success(`Verified: ${teacher.full_name}. Credentials generated!`);
            }
        } catch (error) {
            setVerifiedTeacher(null);
            setFormData(prev => ({ ...prev, teacher_id: '' }));
            toast.error(error.response?.data?.message || 'Teacher not found');
        } finally {
            setIsVerifying(false);
        }
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const uploadData = new FormData();
        uploadData.append('file', file);

        try {
            setIsUploading(true);
            const res = await api.post('/users/upload', uploadData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            if (res.data.success) {
                if (res.data.errors && res.data.errors.length > 0) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Upload Partially Successful',
                        text: res.data.message,
                        html: `<p>${res.data.message}</p><div class="text-start" style="max-height: 200px; overflow-y: auto;"><small class="text-danger">${res.data.errors.join('<br>')}</small></div>`,
                        confirmButtonColor: '#3085d6',
                    });
                } else {
                    Swal.fire({
                        icon: 'success',
                        title: 'Upload Successful',
                        text: res.data.message,
                        timer: 2000,
                        showConfirmButton: false
                    });
                }
                fetchData();
            }
        } catch (error) {
            toast.error(error.response?.data?.message || 'Upload failed');
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleDownloadTemplate = () => {
        let templateContent = "username,email,password,role,mobile,department_code,employee_code\nshivam001,shivam.sample@college.edu,Shivam@001#,FACULTY,9876543210,CSAE,EMP001\nadmin.cs,admin.cs.sample@college.edu,Admin@123#,DEPARTMENT_ADMIN,9876543211,CSAE,";
        if (currentUser.role === 'DEPARTMENT_ADMIN') {
            templateContent = "username,email,password,mobile,employee_code\nshivam001,shivam.sample@college.edu,Shivam@001#,9876543210,EMP001\nrajesh002,rajesh.sample@college.edu,Rajesh@002#,9876543211,EMP002";
        }

        const blob = new Blob([templateContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'users_upload_template.csv';
        a.click();
        window.URL.revokeObjectURL(url);
    };

    const handlePwdSubmit = async (e) => {
        e.preventDefault();
        try {
            await api.put(`/users/${editingUser.id}/password`, pwdData);
            toast.success("Password reset successfully");
            setIsPwdModalOpen(false);
        } catch (error) {
            toast.error(error.response?.data?.message || "Password reset failed");
        }
    };

    const columns = [
        {
            header: '#',
            accessor: 'id',
            render: (_, row) => (page - 1) * 20 + paginatedUsers.indexOf(row) + 1
        },
        { header: 'Username', accessor: 'username', sortable: true },
        { header: 'Email', accessor: 'email', sortable: true },
        {
            header: 'Role',
            accessor: 'role',
            render: (val) => {
                let badgeClass = 'bg-secondary';
                if (val === 'SUPER_ADMIN') badgeClass = 'bg-danger';
                else if (val === 'DEPARTMENT_ADMIN') badgeClass = 'bg-primary';
                else if (val === 'FACULTY') badgeClass = 'bg-info';
                return <span className={`badge ${badgeClass} text-uppercase`}>{val?.replace('_', ' ')}</span>;
            }
        },
        {
            header: 'Department',
            accessor: 'department_id',
            render: (val) => {
                if (!val) return <span className="text-muted small">None</span>;
                const dept = departments.find(d => d.id === parseInt(val));
                const dName = dept?.name || `Dept #${val}`;
                const display = dept?.short_code || dName;
                return <span className="badge bg-info bg-opacity-10 text-info border border-info-subtle" title={dName}>{display}</span>;
            }
        },

        {
            header: 'Status',
            accessor: 'is_active',
            render: (val, row) => val ? (
                <span className="badge bg-success d-inline-flex align-items-center gap-1">
                    <i className="bi bi-check-circle-fill"></i> Active
                </span>
            ) : (
                <span className="badge bg-danger d-inline-flex align-items-center gap-1" title={row.failed_login_attempts >= 10 ? "Locked out due to 10+ failed attempts" : "Account Blocked"}>
                    <i className="bi bi-lock-fill"></i> {row.failed_login_attempts >= 10 ? 'Locked (10 Attempts)' : 'Blocked'}
                </span>
            )
        },
        {
            header: 'Created At',
            accessor: 'created_at',
            render: (val) => new Date(val).toLocaleDateString()
        },
        {
            header: 'Actions',
            render: (_, row) => (
                <div className="d-flex align-items-center gap-2">
                    <button
                        className={`btn btn-sm ${row.is_active ? 'btn-outline-danger' : 'btn-success text-white'}`}
                        onClick={() => handleToggleBlock(row)}
                        title={row.is_active ? "Block User" : "Unblock User"}
                    >
                        <i className={`bi ${row.is_active ? 'bi-lock-fill' : 'bi-unlock-fill'} me-1`}></i>
                        {row.is_active ? 'Block' : 'Unblock'}
                    </button>
                    <button className="btn btn-sm btn-outline-warning" onClick={() => handlePwdChange(row)} title="Reset Password">
                        <i className="bi bi-key"></i>
                    </button>
                    {['SUPER_ADMIN', 'DEPARTMENT_ADMIN'].includes(currentUser.role) && row.role === 'FACULTY' && (
                        <button className="btn btn-sm btn-outline-info" onClick={() => handleManagePermissions(row)} title="Manage Permissions">
                            <i className="bi bi-shield-lock me-1"></i>
                        </button>
                    )}
                    <ActionButtons
                        onEdit={() => handleEdit(row)}
                        onDelete={currentUser.role === 'SUPER_ADMIN' ? () => handleDelete(row.id) : null}
                    />
                </div>
            )
        }
    ];

    const filteredUsers = users.filter(u => {
        const matchesSearch =
            (u.username && u.username.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (u.email && u.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (u.role && u.role.toLowerCase().replace('_', ' ').includes(searchTerm.toLowerCase()));

        const matchesDept = deptFilter ? u.department_id === parseInt(deptFilter) : true;

        return matchesSearch && matchesDept;
    });

    const itemsPerPage = 20;
    const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
    const paginatedUsers = filteredUsers.slice((page - 1) * itemsPerPage, page * itemsPerPage);

    return (
        <div>
            <PageHeader
                title="User Management"
                subtitle="Manage system access and roles"
                icon="bi-people"
                actionButton={{
                    label: "Add User",
                    icon: "bi-person-plus",
                    onClick: handleAdd,
                    className: "btn-primary rounded-pill px-4 shadow-sm"
                }}
            />

            <div className="card shadow-sm border-0 mb-4">
                <div className="card-body">
                    <div className="d-flex justify-content-between align-items-center flex-wrap gap-3">
                        <div className="d-flex align-items-center gap-2">
                            <i className="bi bi-file-earmark-spreadsheet text-success fs-4"></i>
                            <div>
                                <h6 className="mb-0 fw-bold">Bulk Upload Users</h6>
                                <small className="text-muted">Upload multiple users at once using a CSV file</small>
                            </div>
                        </div>
                        <div className="d-flex gap-2">
                            <button onClick={handleDownloadTemplate} className="btn btn-outline-primary btn-sm">
                                <i className="bi bi-download me-2"></i>Download Template
                            </button>
                            <div>
                                <input
                                    type="file"
                                    accept=".csv, .xlsx, .xls"
                                    className="d-none"
                                    ref={fileInputRef}
                                    onChange={handleFileUpload}
                                />
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="btn btn-success btn-sm"
                                    disabled={isUploading}
                                >
                                    {isUploading ? (
                                        <><span className="spinner-border spinner-border-sm me-2"></span>Uploading...</>
                                    ) : (
                                        <><i className="bi bi-upload me-2"></i>Upload File</>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="d-flex justify-content-end mb-3 gap-2">
                <button
                    onClick={() => setIsAnalyseModalOpen(true)}
                    className="btn btn-outline-info rounded-pill shadow-sm"
                >
                    <i className="bi bi-shield-lock me-2"></i> Analyse Permissions
                </button>
                <button
                    onClick={() => exportToExcel({
                        filename: 'User_Management',
                        sheetName: 'Users',
                        columns: [
                            { header: '#', key: (_, idx) => idx + 1 },
                            { header: 'Username', key: 'username' },
                            { header: 'Email', key: 'email' },
                            { header: 'Role', key: 'role' },
                            { header: 'Department', key: 'department_name' },
                            { header: 'Mobile', key: 'mobile' },
                            { header: 'Status', key: row => row.is_active ? 'Active' : 'Blocked' },
                            { header: 'Created At', key: row => row.created_at ? new Date(row.created_at).toLocaleDateString('en-IN') : '' },
                        ],
                        data: users,
                        notes: [
                            '✅ Included: Username, Email, Role, Department, Mobile, Status, Created Date',
                            '❌ Excluded: Passwords, Login tokens, Linked Teacher ID, Audit logs',
                            'ℹ️ This exports all loaded users. Sensitive credentials are never exported.',
                        ],
                    })}
                    className="btn btn-outline-success rounded-pill shadow-sm"
                >
                    <i className="bi bi-file-earmark-excel me-2"></i> Export Excel
                </button>
            </div>

            <DataTable
                columns={columns}
                data={paginatedUsers}
                loading={loading}
                searchPlaceholder="Search users..."
                searchTerm={searchTerm}
                onSearch={(val) => { setSearchTerm(val); setPage(1); }}
                page={page}
                totalPages={totalPages}
                setPage={setPage}
                rightActions={
                    <select
                        className="form-select form-select-sm"
                        value={deptFilter}
                        onChange={e => {
                            setDeptFilter(e.target.value);
                            setPage(1);
                        }}
                        style={{ minWidth: '180px' }}
                    >
                        <option value="">All Departments</option>
                        {departments.map(d => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                    </select>
                }
                totalRows={filteredUsers.length}
            />

            <FormModal show={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingUser ? "Edit User" : "Add User"} onSubmit={handleSubmit}>
                {currentUser.role === 'SUPER_ADMIN' && (
                    <div className="mb-3">
                        <label className="form-label">Role <span className="text-danger">*</span></label>
                        <select className="form-select text-uppercase" name="role" value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })} required>
                            <option value="">Select Role</option>
                            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                        {formData.role === 'SUPER_ADMIN' && <div className="form-text text-danger mt-1 fw-medium"><i className="bi bi-exclamation-triangle-fill me-1"></i> Grants full system access (Full Access).</div>}
                        {formData.role === 'DEPARTMENT_ADMIN' && <div className="form-text text-primary mt-1 fw-medium"><i className="bi bi-info-circle-fill me-1"></i> Allows the HOD or Dean of the selected department to manage their timetable.</div>}
                        {formData.role === 'FACULTY' && <div className="form-text text-info mt-1 fw-medium"><i className="bi bi-info-circle-fill me-1"></i> Allows the teacher to view their timetable and receive notifications.</div>}
                    </div>
                )}

                {formData.role === 'DEPARTMENT_ADMIN' && currentUser.role === 'SUPER_ADMIN' && (
                    <div className="mb-3">
                        <label className="form-label">Department <span className="text-danger">*</span></label>
                        <select className="form-select" value={formData.department_id} onChange={e => setFormData({ ...formData, department_id: e.target.value })} required>
                            <option value="">Select Department</option>
                            {departments.map(d => (
                                <option key={d.id} value={d.id}>{d.name} ({d.short_code})</option>
                            ))}
                        </select>
                        <small className="text-muted d-block mb-2">Select the department this user will manage.</small>
                        {(() => {
                            const existingAdmin = users.find(u => u.role === 'DEPARTMENT_ADMIN' && u.department_id == formData.department_id && (!editingUser || u.id !== editingUser.id));
                            if (existingAdmin && formData.department_id) {
                                return (
                                    <div className="alert alert-warning py-2 px-3 small border border-warning mb-2 d-flex align-items-start">
                                        <i className="bi bi-exclamation-triangle-fill fs-5 me-2 text-warning flex-shrink-0 mt-1"></i>
                                        <div>
                                            <strong>Already assigned:</strong> An admin (<b>{existingAdmin.username}</b>) already exists for this department. You can create more than one department admin, but please note an admin is already present.
                                        </div>
                                    </div>
                                );
                            }
                            return null;
                        })()}
                    </div>
                )}

                {formData.role === 'FACULTY' && (
                    <div className="p-3 bg-light rounded-3 mb-3 border border-secondary-subtle">
                        <h6 className="mb-3 text-secondary"><i className="bi bi-person-badge me-2"></i>Faculty Details</h6>
                        <div className="mb-3">
                            <label className="form-label">Employee ID <span className="text-danger">*</span></label>
                            <div className="input-group">
                                <input
                                    type="text"
                                    className="form-control"
                                    value={formData.employee_code}
                                    onChange={e => {
                                        setFormData({ ...formData, employee_code: e.target.value, teacher_id: '' });
                                        setVerifiedTeacher(null);
                                    }}
                                    placeholder="Enter Employee ID (e.g. EMP001)"
                                    disabled={!!editingUser}
                                    required
                                />
                                {!editingUser && (
                                    <button
                                        className="btn btn-primary"
                                        type="button"
                                        onClick={handleVerifyTeacher}
                                        disabled={isVerifying || !formData.employee_code}
                                    >
                                        {isVerifying ? <span className="spinner-border spinner-border-sm"></span> : <><i className="bi bi-check2-circle me-1"></i>Verify</>}
                                    </button>
                                )}
                            </div>
                            {verifiedTeacher && (
                                <div className="mt-2 p-2 bg-success-subtle border border-success rounded small text-success-emphasis fw-medium">
                                    <i className="bi bi-check-circle-fill me-1"></i> <strong>Verified:</strong> {verifiedTeacher.full_name} &bull; Emp ID: {verifiedTeacher.employee_code} &bull; Dept: {verifiedTeacher.department_name}
                                </div>
                            )}
                        </div>
                        <div className="mb-3">
                            <label className="form-label">Mobile Number <span className="text-danger">*</span></label>
                            <input
                                type="text"
                                className="form-control"
                                value={formData.mobile}
                                onChange={e => setFormData({ ...formData, mobile: e.target.value })}
                                placeholder="Enter mobile number"
                                required
                            />
                        </div>
                        {verifiedTeacher && !editingUser && (
                            <div className="alert alert-info py-2 px-3 small border border-info mb-0">
                                <i className="bi bi-info-circle-fill me-2"></i>
                                <strong>Auto-generated credentials below:</strong> Username &amp; default password have been automatically generated. You can change them before saving.
                            </div>
                        )}
                    </div>
                )}

                {formData.role && (
                    <>
                        <div className="mb-3">
                            <label className="form-label">Username <span className="text-danger">*</span></label>
                            <input
                                type="text"
                                className="form-control"
                                name="username"
                                value={formData.username}
                                onChange={e => {
                                    const val = e.target.value;
                                    setFormData(prev => {
                                        const nextData = { ...prev, username: val };
                                        if (!editingUser && prev.role !== 'FACULTY') {
                                            if (val) {
                                                const firstName = val.trim().split(' ')[0];
                                                nextData.password = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase() + '@321#' : '';
                                            } else {
                                                nextData.password = '';
                                            }
                                        }
                                        return nextData;
                                    });
                                }}
                                disabled={!!editingUser}
                                required
                            />
                            {formData.role === 'FACULTY' && verifiedTeacher && !editingUser && (
                                <div className="form-text small text-muted">Auto-generated from Employee Name &amp; ID (e.g. shivam001). Editable.</div>
                            )}
                        </div>
                        <div className="mb-3">
                            <label className="form-label">Email <span className="text-danger">*</span></label>
                            <input type="email" className="form-control" name="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} required />
                        </div>
                        {!editingUser && (
                            <div className="mb-3">
                                <label className="form-label">Password <span className="text-danger">*</span></label>
                                <div className="input-group">
                                    <input
                                        type={showPwd ? "text" : "password"}
                                        className="form-control"
                                        name="password"
                                        value={formData.password}
                                        onChange={e => setFormData({ ...formData, password: e.target.value })}
                                        required={!editingUser}
                                    />
                                    <button
                                        className="btn btn-outline-secondary"
                                        type="button"
                                        onClick={() => setShowPwd(!showPwd)}
                                        tabIndex="-1"
                                    >
                                        <i className={`bi bi-eye${showPwd ? '-slash' : ''}`}></i>
                                    </button>
                                </div>
                                {formData.role === 'FACULTY' && verifiedTeacher && (
                                    <div className="form-text small text-muted">Default auto password generated (e.g. Shivam@001#). Editable.</div>
                                )}
                            </div>
                        )}
                        {['SUPER_ADMIN', 'DEPARTMENT_ADMIN'].includes(formData.role) && (
                            <div className="mb-3">
                                <label className="form-label">Mobile Number (Optional)</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    value={formData.mobile}
                                    onChange={e => setFormData({ ...formData, mobile: e.target.value })}
                                    placeholder="Enter mobile number"
                                />
                            </div>
                        )}
                        {editingUser && (
                            <div className="mb-3">
                                <label className="form-label">Status</label>
                                <select className="form-select" value={formData.is_active} onChange={e => setFormData({ ...formData, is_active: parseInt(e.target.value) })}>
                                    <option value={1}>Active</option>
                                    <option value={0}>Inactive (Locked)</option>
                                </select>
                            </div>
                        )}
                    </>
                )}
            </FormModal>

            <FormModal show={isPwdModalOpen} onClose={() => setIsPwdModalOpen(false)} title="Reset Password" onSubmit={handlePwdSubmit}>
                {editingUser?.role === 'FACULTY' && (
                    <div className="mb-3">
                        <label className="form-label">Employee ID <span className="text-danger">*</span></label>
                        <input
                            type="text"
                            className="form-control"
                            value={pwdData.employee_code}
                            onChange={e => setPwdData({ ...pwdData, employee_code: e.target.value })}
                            required
                            placeholder="Confirm Employee ID"
                        />
                    </div>
                )}
                <div className="mb-3">
                    <label className="form-label">New Password for {editingUser?.username} <span className="text-danger">*</span></label>
                    <div className="input-group">
                        <input
                            type={showResetPwd ? "text" : "password"}
                            className="form-control"
                            value={pwdData.new_password}
                            onChange={e => setPwdData({ new_password: e.target.value })}
                            required
                        />
                        <button
                            className="btn btn-outline-secondary"
                            type="button"
                            onClick={() => setShowResetPwd(!showResetPwd)}
                            tabIndex="-1"
                        >
                            <i className={`bi bi-eye${showResetPwd ? '-slash' : ''}`}></i>
                        </button>
                    </div>
                </div>
            </FormModal>

            <FormModal show={isPermModalOpen} onClose={() => setIsPermModalOpen(false)} title="Manage Permissions" onSubmit={handlePermSubmit}>
                {editingUser && (
                    <div className="mb-3">
                        <p className="form-label mb-3">Assign specific module permissions to <strong>{editingUser.username}</strong></p>
                        <div className="list-group">
                            {[
                                { id: 'manage_internal_tests', label: 'Internal Tests & Exams' },
                                { id: 'manage_leaves', label: 'Leaves Management' },
                                { id: 'manage_subjects', label: 'Subjects Management' },
                                { id: 'manage_classes', label: 'Classes & Sections' },
                                { id: 'manage_rooms', label: 'Rooms & Labs' }
                            ].map(perm => {
                                const isAdmin = ['SUPER_ADMIN', 'DEPARTMENT_ADMIN'].includes(editingUser.role);
                                return (
                                    <label key={perm.id} className="list-group-item d-flex gap-3 align-items-center cursor-pointer">
                                        <input
                                            className="form-check-input flex-shrink-0 mt-0"
                                            type="checkbox"
                                            value={perm.id}
                                            checked={isAdmin || selectedUserPerms.includes(perm.id)}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    setSelectedUserPerms([...selectedUserPerms, perm.id]);
                                                } else {
                                                    setSelectedUserPerms(selectedUserPerms.filter(p => p !== perm.id));
                                                }
                                            }}
                                            disabled={isAdmin}
                                            style={{ width: '1.2em', height: '1.2em' }}
                                        />
                                        <div>
                                            <h6 className="mb-0">{perm.label}</h6>
                                            {isAdmin && <small className="text-muted">Admins have full access by default</small>}
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                )}
            </FormModal>
            {/* Analyse Permissions Modal */}
            {isAnalyseModalOpen && (
                <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
                        <div className="modal-content">
                            <div className="modal-header bg-info text-white">
                                <h5 className="modal-title">
                                    <i className="bi bi-shield-lock me-2"></i> Analyse Permissions
                                </h5>
                                <button type="button" className="btn-close btn-close-white" onClick={() => setIsAnalyseModalOpen(false)}></button>
                            </div>
                            <div className="modal-body p-0">
                                <table className="table table-hover mb-0">
                                    <thead className="table-light">
                                        <tr>
                                            <th>Username</th>
                                            <th>Role</th>
                                            <th>Department</th>
                                            <th>Delegated Permissions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {users.filter(u => {
                                            if (u.role === 'SUPER_ADMIN' || u.role === 'DEPARTMENT_ADMIN') return false;
                                            let perms = [];
                                            if (typeof u.permissions === 'string') {
                                                try { perms = JSON.parse(u.permissions); } catch (e) { }
                                            } else if (Array.isArray(u.permissions)) {
                                                perms = u.permissions;
                                            }
                                            return perms && perms.length > 0;
                                        }).map(u => {
                                            let perms = [];
                                            if (typeof u.permissions === 'string') {
                                                try { perms = JSON.parse(u.permissions); } catch (e) { }
                                            } else if (Array.isArray(u.permissions)) {
                                                perms = u.permissions;
                                            }
                                            const dept = departments.find(d => d.id === u.department_id);
                                            return (
                                                <tr key={u.id}>
                                                    <td>{u.username}</td>
                                                    <td><span className="badge bg-info">FACULTY</span></td>
                                                    <td>{dept ? dept.short_code || dept.name : '-'}</td>
                                                    <td>
                                                        <div className="d-flex flex-wrap gap-1">
                                                            {perms.map(p => (
                                                                <span key={p} className="badge bg-secondary bg-opacity-10 text-secondary border border-secondary-subtle text-capitalize">
                                                                    {p.replace('manage_', '').replace('_', ' ')}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {users.filter(u => {
                                            if (u.role === 'SUPER_ADMIN' || u.role === 'DEPARTMENT_ADMIN') return false;
                                            let perms = [];
                                            if (typeof u.permissions === 'string') {
                                                try { perms = JSON.parse(u.permissions); } catch (e) { }
                                            } else if (Array.isArray(u.permissions)) {
                                                perms = u.permissions;
                                            }
                                            return perms && perms.length > 0;
                                        }).length === 0 && (
                                                <tr>
                                                    <td colSpan="4" className="text-center py-4 text-muted">
                                                        No faculty members have been granted special permissions yet.
                                                    </td>
                                                </tr>
                                            )}
                                    </tbody>
                                </table>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => setIsAnalyseModalOpen(false)}>Close</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UserManagement;
