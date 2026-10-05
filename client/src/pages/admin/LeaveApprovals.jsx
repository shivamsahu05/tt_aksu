import React, { useState, useEffect, useMemo } from 'react';
import api from '../../utils/api';
import PageHeader from '../../components/common/PageHeader';
import DataTable from '../../components/common/DataTable';
import { toast } from 'react-toastify';
import FormModal from '../../components/common/FormModal';
import Swal from 'sweetalert2';
import { useForm } from 'react-hook-form';

import ActionButtons from '../../components/common/ActionButtons';
import { safeDelete } from '../../utils/alerts';

const Leaves = () => {
    const [leaves, setLeaves] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [departments, setDepartments] = useState([]);
    const [teachers, setTeachers] = useState([]);
    const [teacherHistory, setTeacherHistory] = useState([]);

    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [historyMonth, setHistoryMonth] = useState(new Date().toISOString().slice(0, 7));

    const [globalDept, setGlobalDept] = useState('');
    const [globalTeacher, setGlobalTeacher] = useState('');
    const [globalTeachers, setGlobalTeachers] = useState([]);
    const [globalDateFilter, setGlobalDateFilter] = useState('all');

    const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm();
    const selectedDept = watch('department_id');
    const selectedTeacher = watch('teacher_id');

    const fetchLeaves = async () => {
        try {
            setLoading(true);
            let url = '/leaves?';
            if (globalDept) url += `department_id=${globalDept}&`;
            if (globalTeacher) url += `teacher_id=${globalTeacher}&`;
            
            const res = await api.get(url);
            setLeaves(res.data.data || []);
        } catch (error) {
            toast.error('Failed to load leaves');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLeaves();
        api.get('/departments?limit=100').then(res => setDepartments(res.data.data || [])).catch(() => {});
    }, [globalDept, globalTeacher]);

    useEffect(() => {
        if (globalDept) {
            api.get(`/teachers?limit=100&department_id=${globalDept}`)
                .then(res => setGlobalTeachers(res.data.data || []))
                .catch(() => {});
        } else {
            setGlobalTeachers([]);
        }
    }, [globalDept]);

    useEffect(() => {
        if (selectedDept) {
            api.get(`/teachers?limit=100&department_id=${selectedDept}`)
                .then(res => setTeachers(res.data.data || []))
                .catch(() => {});
        } else {
            setTeachers([]);
        }
    }, [selectedDept]);

    useEffect(() => {
        if (selectedTeacher && !editItem) {
            api.get(`/leaves?teacher_id=${selectedTeacher}`)
                .then(res => setTeacherHistory(res.data.data || []))
                .catch(() => setTeacherHistory([]));
        } else {
            setTeacherHistory([]);
        }
    }, [selectedTeacher, editItem]);

    const setQuickDate = (days) => {
        const date = new Date();
        date.setDate(date.getDate() + days);
        const dateString = date.toISOString().split('T')[0];
        setValue('leave_start', dateString, { shouldValidate: true });
        setValue('leave_end', dateString, { shouldValidate: true });
    };

    const openAddModal = () => {
        setEditItem(null);
        reset({ department_id: '', teacher_id: '', leave_start: '', leave_end: '', reason: '' });
        setShowModal(true);
    };

    const openEditModal = (leave) => {
        setEditItem(leave);
        
        // Find department of teacher if not explicitly sent by DB (the join doesn't return it by default)
        // Wait, the API only returns `teacher_name` and `approver_name`. We need to match department.
        // Or we can just let `selectedDept` be empty or infer it if possible.
        // Actually we don't have `department_id` in the leave row... 
        // Let's just set the teacher_id and leave the department unselected or we can just fetch all teachers and find it.
        // For simplicity we will bypass setting department if it's tricky, but `teachers` list depends on `selectedDept`.
        // To fix this we can just fetch all teachers without filter if edit.
        
        // As a shortcut, if we edit, we just set the values. Since teachers load by department, it might be tricky.
        reset({
            leave_start: leave.leave_start ? new Date(leave.leave_start).toISOString().split('T')[0] : '',
            leave_end: leave.leave_end ? new Date(leave.leave_end).toISOString().split('T')[0] : '',
            reason: leave.reason || ''
        });
        setShowModal(true);
    };

    const onSubmit = async (data) => {
        try {
            if (editItem) {
                // If editing, we might not have department_id and teacher_id if we disabled them, so we merge.
                await api.put(`/leaves/${editItem.id}`, {
                    ...data,
                    teacher_id: data.teacher_id || editItem.teacher_id
                });
                toast.success('Leave updated successfully');
            } else {
                await api.post('/leaves', data);
                toast.success('Leave applied successfully');
            }
            setShowModal(false);
            fetchLeaves();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to save leave');
        }
    };

    const handleDelete = (id) => {
        safeDelete('this leave record', async () => {
            try {
                await api.delete(`/leaves/${id}`);
                toast.success('Leave deleted successfully');
                fetchLeaves();
            } catch (error) {
                toast.error('Failed to delete leave');
            }
        });
    };

    const getLeavesForMonth = () => {
        if (!historyMonth) return [];
        const [year, month] = historyMonth.split('-');
        const filterStart = new Date(year, month - 1, 1);
        const filterEnd = new Date(year, month, 0); // last day of month

        return leaves.filter(l => {
            const lStart = new Date(l.leave_start);
            const lEnd = new Date(l.leave_end);
            return lStart <= filterEnd && lEnd >= filterStart;
        });
    };

    const filteredLeaves = useMemo(() => {
        if (globalDateFilter === 'all') return leaves;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);

        const next3Days = new Date(today);
        next3Days.setDate(today.getDate() + 3);

        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

        const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);

        return leaves.filter(l => {
            if (!l.leave_start || !l.leave_end) return true;
            
            const lStart = new Date(l.leave_start);
            lStart.setHours(0, 0, 0, 0);
            
            const lEnd = new Date(l.leave_end);
            lEnd.setHours(23, 59, 59, 999);

            switch (globalDateFilter) {
                case 'today':
                    return lStart <= today && lEnd >= today;
                case 'tomorrow':
                    return lStart <= tomorrow && lEnd >= tomorrow;
                case 'next3days':
                    return lStart <= next3Days && lEnd >= today;
                case 'this_month':
                    return lStart <= endOfMonth && lEnd >= startOfMonth;
                case 'last_month':
                    return lStart <= endOfLastMonth && lEnd >= startOfLastMonth;
                default:
                    return true;
            }
        });
    }, [leaves, globalDateFilter]);

    const columns = [
        { label: 'Teacher' },
        { label: 'Applied On', headerStyle: { width: '120px' } },
        { label: 'Leave Period' },
        { label: 'Reason' },
        { label: 'Actions', headerStyle: { width: '120px', textAlign: 'right' } },
    ];

    return (
        <div>
            <PageHeader
                title="Leaves"
                subtitle="Record and manage faculty leaves"
                icon="bi-calendar-check-fill"
                rightContent={
                    <div className="d-flex gap-2">
                        <button className="btn btn-outline-info bg-light shadow-sm" onClick={() => setShowHistoryModal(true)}>
                            <i className="bi bi-clock-history me-2"></i> Monthly History
                        </button>
                        <button className="btn btn-primary shadow-sm" onClick={openAddModal}>
                            <i className="bi bi-plus-lg me-2"></i> Add Leave
                        </button>
                    </div>
                }
            />

            {/* Global Filters */}
            <div className="card border-0 shadow-sm rounded-4 mb-4">
                <div className="card-body p-4">
                    <div className="row g-3">
                        <div className="col-md-4">
                            <label className="form-label fw-bold text-dark small">Filter by Department</label>
                            <select 
                                className="form-select border-0 bg-light"
                                value={globalDept}
                                onChange={(e) => {
                                    setGlobalDept(e.target.value);
                                    setGlobalTeacher('');
                                }}
                            >
                                <option value="">All Departments</option>
                                {departments.map(d => (
                                    <option key={d.id} value={d.id}>{d.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="col-md-4">
                            <label className="form-label fw-bold text-dark small">Filter by Teacher</label>
                            <select 
                                className="form-select border-0 bg-light"
                                value={globalTeacher}
                                onChange={(e) => setGlobalTeacher(e.target.value)}
                                disabled={!globalDept || globalTeachers.length === 0}
                            >
                                <option value="">All Teachers</option>
                                {globalTeachers.map(t => (
                                    <option key={t.id} value={t.id}>{t.full_name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="col-md-4">
                            <label className="form-label fw-bold text-dark small">Filter by Date Range</label>
                            <select 
                                className="form-select border-0 bg-light"
                                value={globalDateFilter}
                                onChange={(e) => setGlobalDateFilter(e.target.value)}
                            >
                                <option value="all">All Time</option>
                                <option value="today">Today</option>
                                <option value="tomorrow">Tomorrow</option>
                                <option value="next3days">Next 3 Days</option>
                                <option value="this_month">This Month</option>
                                <option value="last_month">Previous Month</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            <DataTable
                columns={columns}
                data={filteredLeaves}
                loading={loading}
                emptyMessage="No leave requests found."
                emptyIcon="bi-calendar-check"
                hidePagination
                renderRow={(row) => {
                    return (
                        <tr key={row.id}>
                            <td style={{ paddingLeft: '16px' }}>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '14px' }}>{row.teacher_name}</div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{row.department_name}</div>
                            </td>
                            <td style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                                {row.applied_at ? new Date(row.applied_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}
                            </td>
                            <td>
                                <div style={{ fontWeight: 500, fontSize: '13px', color: 'var(--text-primary)' }}>
                                    {row.leave_start ? new Date(row.leave_start).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}
                                    {' – '}
                                    {row.leave_end ? new Date(row.leave_end).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                                </div>
                            </td>
                            <td style={{ maxWidth: '200px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {row.reason || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No reason</span>}
                                </div>
                            </td>
                            <td style={{ paddingRight: '16px', textAlign: 'right' }}>
                                <ActionButtons 
                                    onEdit={() => openEditModal(row)}
                                    onDelete={() => handleDelete(row.id)}
                                />
                            </td>
                        </tr>
                    );
                }}
            />

            <FormModal
                show={showModal}
                title={editItem ? "Edit Leave Request" : "Add Leave Request"}
                onClose={() => setShowModal(false)}
                onSubmit={handleSubmit(onSubmit)}
                isSubmitting={isSubmitting}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {!editItem && (
                        <>
                            <div>
                                <label className="form-label">Department <span style={{ color: 'var(--danger)' }}>*</span></label>
                                <select
                                    className={`form-select ${errors.department_id ? 'is-invalid' : ''}`}
                                    {...register('department_id', { required: 'Department is required' })}
                                >
                                    <option value="">Select Department...</option>
                                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                </select>
                                {errors.department_id && <div className="invalid-feedback">{errors.department_id.message}</div>}
                            </div>

                            <div>
                                <label className="form-label">Teacher <span style={{ color: 'var(--danger)' }}>*</span></label>
                                <select
                                    className={`form-select ${errors.teacher_id ? 'is-invalid' : ''}`}
                                    {...register('teacher_id', { required: 'Teacher is required' })}
                                    disabled={!selectedDept || teachers.length === 0}
                                >
                                    <option value="">Select Teacher...</option>
                                    {teachers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                                </select>
                                {errors.teacher_id && <div className="invalid-feedback">{errors.teacher_id.message}</div>}
                            </div>
                            
                            {selectedTeacher && !editItem && (
                                <div className="p-3 bg-light border rounded">
                                    <div className="fw-bold small mb-2 text-primary"><i className="bi bi-clock-history me-1"></i> Recent Leave History</div>
                                    {teacherHistory.length > 0 ? (
                                        <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
                                            {teacherHistory.map(h => (
                                                <div key={h.id} className="d-flex justify-content-between align-items-center mb-1 pb-1 border-bottom" style={{borderColor: '#e9ecef'}}>
                                                    <span className="small text-dark">
                                                        {new Date(h.leave_start).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} 
                                                        {' to '} 
                                                        {new Date(h.leave_end).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                                                    </span>
                                                    <span className={`badge ${h.status === 'approved' ? 'bg-success' : h.status === 'rejected' ? 'bg-danger' : 'bg-warning'}`}>
                                                        {h.status}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-muted small">No past leaves found for this teacher.</div>
                                    )}
                                </div>
                            )}
                        </>
                    )}

                    <div>
                        <div className="d-flex justify-content-between align-items-center mb-2">
                            <label className="form-label mb-0 fw-bold text-dark">Leave Duration</label>
                            <div className="btn-group">
                                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setQuickDate(0)}>Today</button>
                                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setQuickDate(1)}>Tomorrow</button>
                                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setQuickDate(2)}>Day After</button>
                            </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            <div>
                                <label className="form-label small text-muted">Start Date <span style={{ color: 'var(--danger)' }}>*</span></label>
                                <input
                                    type="date"
                                    className={`form-control ${errors.leave_start ? 'is-invalid' : ''}`}
                                    {...register('leave_start', { required: 'Start date required' })}
                                />
                                {errors.leave_start && <div className="invalid-feedback">{errors.leave_start.message}</div>}
                            </div>
                            <div>
                                <label className="form-label small text-muted">End Date <span style={{ color: 'var(--danger)' }}>*</span></label>
                                <input
                                    type="date"
                                    className={`form-control ${errors.leave_end ? 'is-invalid' : ''}`}
                                    {...register('leave_end', { required: 'End date required' })}
                                />
                                {errors.leave_end && <div className="invalid-feedback">{errors.leave_end.message}</div>}
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="form-label">Reason <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '12px' }}>(optional)</span></label>
                        <textarea
                            className="form-control"
                            rows="3"
                            placeholder="Reason for leave..."
                            style={{ resize: 'none' }}
                            {...register('reason')}
                        />
                    </div>
                </div>
            </FormModal>

            {/* Monthly History Modal */}
            <div className={`modal fade ${showHistoryModal ? 'show' : ''}`} style={{ display: showHistoryModal ? 'block' : 'none', backgroundColor: 'rgba(0,0,0,0.5)' }}>
                <div className="modal-dialog modal-dialog-centered modal-lg">
                    <div className="modal-content border-0 shadow-lg rounded-4">
                        <div className="modal-header border-bottom-0 pb-0">
                            <h5 className="modal-title fw-bold text-dark"><i className="bi bi-clock-history me-2 text-info"></i> Monthly Leave History</h5>
                            <button type="button" className="btn-close" onClick={() => setShowHistoryModal(false)}></button>
                        </div>
                        <div className="modal-body p-4">
                            <div className="mb-4">
                                <label className="form-label fw-bold text-dark small">Select Month</label>
                                <input type="month" className="form-control border-0 bg-light" style={{maxWidth: '250px'}} value={historyMonth} onChange={e => setHistoryMonth(e.target.value)} />
                            </div>
                            
                            <div style={{ maxHeight: '450px', overflowY: 'auto' }} className="pe-2">
                                {getLeavesForMonth().length > 0 ? (
                                    <div className="list-group">
                                        {getLeavesForMonth().map(h => (
                                            <div key={h.id} className="list-group-item border-0 shadow-sm rounded-3 mb-3 p-3">
                                                <div className="d-flex justify-content-between align-items-center mb-2">
                                                    <div className="fw-bold text-dark fs-6">{h.teacher_name} <span className="fw-normal text-muted small ms-1">({h.department_name})</span></div>
                                                    <span className={`badge ${h.status === 'approved' ? 'bg-success' : h.status === 'rejected' ? 'bg-danger' : 'bg-warning'}`}>{h.status}</span>
                                                </div>
                                                <div className="d-flex flex-column gap-1">
                                                    <div className="text-secondary small fw-medium">
                                                        <i className="bi bi-calendar-event text-primary me-2"></i>
                                                        {new Date(h.leave_start).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} 
                                                        {' to '} 
                                                        {new Date(h.leave_end).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                    </div>
                                                    {h.reason && (
                                                        <div className="text-muted small mt-1 bg-light p-2 rounded border" style={{ fontStyle: 'italic' }}>
                                                            "{h.reason}"
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-center text-muted p-5 border-0 shadow-sm rounded-4 bg-light">
                                        <i className="bi bi-calendar-x opacity-50 d-block mb-3" style={{fontSize: '3rem'}}></i>
                                        <h6 className="fw-bold">No Leaves Recorded</h6>
                                        <p className="small mb-0">There are no leaves in the system for this month.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Leaves;
