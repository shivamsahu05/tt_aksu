import React, { useState, useEffect, useContext } from 'react';
import api from '../../utils/api';
import PageHeader from '../../components/common/PageHeader';
import DataTable from '../../components/common/DataTable';
import { toast } from 'react-toastify';
import FormModal from '../../components/common/FormModal';
import Swal from 'sweetalert2';
import { useForm } from 'react-hook-form';
import ActionButtons from '../../components/common/ActionButtons';
import { safeDelete } from '../../utils/alerts';
import { AuthContext } from '../../context/AuthContext';

// ─── Helper: get YYYY-MM-DD for offset from today ─────────────────────────────
const getDateStr = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().split('T')[0];
};

const DAY_OPTIONS = [
    { label: 'Today',       offset: 0 },
    { label: 'Tomorrow',    offset: 1 },
    { label: 'Day After',   offset: 2 },
];

// ─── Leave Duration Picker ─────────────────────────────────────────────────────
const LeavePicker = ({ selectedDays, onToggle }) => {
    return (
        <div>
            <label className="form-label fw-bold" style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>
                Leave Duration <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '12px' }}>(click to select / deselect — max 3 days)</span>
            </label>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {DAY_OPTIONS.map(({ label, offset }) => {
                    const dateStr = getDateStr(offset);
                    const isSelected = selectedDays.includes(dateStr);
                    const dateLabel = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });

                    return (
                        <button
                            key={offset}
                            type="button"
                            onClick={() => onToggle(dateStr)}
                            style={{
                                flex: 1,
                                minWidth: '120px',
                                padding: '12px 8px',
                                borderRadius: '10px',
                                border: isSelected ? '2px solid var(--primary)' : '2px solid var(--app-border)',
                                background: isSelected
                                    ? 'linear-gradient(135deg, var(--primary) 0%, #6366f1 100%)'
                                    : 'var(--app-surface)',
                                color: isSelected ? '#fff' : 'var(--text-secondary)',
                                cursor: 'pointer',
                                transition: 'all 0.18s ease',
                                textAlign: 'center',
                                boxShadow: isSelected ? '0 4px 12px rgba(99,102,241,0.3)' : 'var(--shadow-sm)',
                                transform: isSelected ? 'translateY(-1px)' : 'none',
                            }}
                        >
                            <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '3px' }}>{label}</div>
                            <div style={{ fontSize: '11px', opacity: isSelected ? 0.9 : 0.65 }}>{dateLabel}</div>
                            {isSelected && (
                                <div style={{ marginTop: '4px' }}>
                                    <i className="bi bi-check-circle-fill" style={{ fontSize: '13px' }} />
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
            {selectedDays.length > 0 && (
                <div style={{
                    marginTop: '10px', padding: '8px 12px', borderRadius: '8px',
                    background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)',
                    fontSize: '12.5px', color: 'var(--primary)', fontWeight: 500
                }}>
                    <i className="bi bi-calendar-check me-2" />
                    {selectedDays.length === 1
                        ? `Leave on: ${new Date(selectedDays[0] + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long' })}`
                        : `Leave from ${new Date(selectedDays[0] + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} to ${new Date(selectedDays[selectedDays.length - 1] + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} (${selectedDays.length} days)`
                    }
                </div>
            )}
        </div>
    );
};

// ─── Main Component ────────────────────────────────────────────────────────────
const Leaves = () => {
    const { user } = useContext(AuthContext);
    const deptId = user?.department_id;

    const [leaves, setLeaves] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [teachers, setTeachers] = useState([]);
    const [teacherHistory, setTeacherHistory] = useState([]);
    const [selectedDays, setSelectedDays] = useState([]); // array of YYYY-MM-DD strings

    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [historyMonth, setHistoryMonth] = useState(new Date().toISOString().slice(0, 7));

    const [globalTeacher, setGlobalTeacher] = useState('');

    const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm();
    const selectedTeacher = watch('teacher_id');

    // ── Fetch leaves ─────────────────────────────────────────────────────────
    const fetchLeaves = async () => {
        try {
            setLoading(true);
            let url = '/leaves?';
            if (deptId) url += `department_id=${deptId}&`;
            if (globalTeacher) url += `teacher_id=${globalTeacher}&`;
            const res = await api.get(url);
            setLeaves(res.data.data || []);
        } catch {
            toast.error('Failed to load leaves');
        } finally {
            setLoading(false);
        }
    };

    // ── Load teachers for this department ────────────────────────────────────
    useEffect(() => {
        if (deptId) {
            api.get(`/teachers?limit=200&department_id=${deptId}`)
                .then(res => setTeachers(res.data.data || []))
                .catch(() => {});
        }
    }, [deptId]);

    useEffect(() => { fetchLeaves(); }, [globalTeacher]);

    // ── Load teacher history in modal ────────────────────────────────────────
    useEffect(() => {
        if (selectedTeacher && !editItem) {
            api.get(`/leaves?teacher_id=${selectedTeacher}`)
                .then(res => setTeacherHistory(res.data.data || []))
                .catch(() => setTeacherHistory([]));
        } else {
            setTeacherHistory([]);
        }
    }, [selectedTeacher, editItem]);

    // ── Day toggle handler ───────────────────────────────────────────────────
    const handleDayToggle = (dateStr) => {
        setSelectedDays(prev => {
            if (prev.includes(dateStr)) {
                return prev.filter(d => d !== dateStr);
            }
            if (prev.length >= 3) {
                toast.warning('Maximum 3 days leave can be added at once');
                return prev;
            }
            // Keep sorted
            return [...prev, dateStr].sort();
        });
    };

    // ── Open Add modal ───────────────────────────────────────────────────────
    const openAddModal = () => {
        setEditItem(null);
        setSelectedDays([]);
        reset({ teacher_id: '', reason: '' });
        setShowModal(true);
    };

    // ── Open Edit modal ──────────────────────────────────────────────────────
    const openEditModal = (leave) => {
        setEditItem(leave);
        setSelectedDays([]); // Edit uses date inputs directly
        reset({
            teacher_id: leave.teacher_id || '',
            leave_start: leave.leave_start ? new Date(leave.leave_start).toISOString().split('T')[0] : '',
            leave_end: leave.leave_end ? new Date(leave.leave_end).toISOString().split('T')[0] : '',
            reason: leave.reason || ''
        });
        setShowModal(true);
    };

    // ── Submit ───────────────────────────────────────────────────────────────
    const onSubmit = async (data) => {
        try {
            if (editItem) {
                await api.put(`/leaves/${editItem.id}`, {
                    ...data,
                    teacher_id: data.teacher_id || editItem.teacher_id
                });
                toast.success('Leave updated successfully');
            } else {
                // Build leave_start / leave_end from selectedDays
                if (selectedDays.length === 0) {
                    toast.error('Please select at least one day for the leave');
                    return;
                }
                const sorted = [...selectedDays].sort();
                await api.post('/leaves', {
                    ...data,
                    department_id: deptId,
                    leave_start: sorted[0],
                    leave_end: sorted[sorted.length - 1],
                });
                toast.success('Leave applied successfully');
            }
            setShowModal(false);
            fetchLeaves();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to save leave');
        }
    };

    // ── Delete ───────────────────────────────────────────────────────────────
    const handleDelete = (id) => {
        safeDelete('this leave record', async () => {
            try {
                await api.delete(`/leaves/${id}`);
                toast.success('Leave deleted successfully');
                fetchLeaves();
            } catch {
                toast.error('Failed to delete leave');
            }
        });
    };

    const getLeavesForMonth = () => {
        if (!historyMonth) return [];
        const [year, month] = historyMonth.split('-');
        const filterStart = new Date(year, month - 1, 1);
        const filterEnd = new Date(year, month, 0);
        return leaves.filter(l => {
            const lStart = new Date(l.leave_start);
            const lEnd = new Date(l.leave_end);
            return lStart <= filterEnd && lEnd >= filterStart;
        });
    };

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
                            <i className="bi bi-clock-history me-2" />Monthly History
                        </button>
                        <button className="btn btn-primary shadow-sm" onClick={openAddModal}>
                            <i className="bi bi-plus-lg me-2" />Add Leave
                        </button>
                    </div>
                }
            />

            {/* ── Global Filter by Teacher ── */}
            <div className="card border-0 shadow-sm rounded-4 mb-4">
                <div className="card-body p-4">
                    <div className="row g-3">
                        <div className="col-md-4">
                            <label className="form-label fw-bold text-dark small">Filter by Teacher</label>
                            <select
                                className="form-select border-0 bg-light"
                                value={globalTeacher}
                                onChange={e => setGlobalTeacher(e.target.value)}
                            >
                                <option value="">All Teachers</option>
                                {teachers.map(t => (
                                    <option key={t.id} value={t.id}>{t.full_name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            <DataTable
                columns={columns}
                data={leaves}
                loading={loading}
                emptyMessage="No leave requests found."
                emptyIcon="bi-calendar-check"
                hidePagination
                renderRow={(row) => (
                    <tr key={row.id}>
                        <td style={{ paddingLeft: '16px' }}>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '14px' }}>{row.teacher_name}</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{row.department_name}</div>
                        </td>
                        <td style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                            {row.applied_at ? new Date(row.applied_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '–'}
                        </td>
                        <td>
                            <div style={{ fontWeight: 500, fontSize: '13px', color: 'var(--text-primary)' }}>
                                {row.leave_start ? new Date(row.leave_start).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '–'}
                                {' – '}
                                {row.leave_end ? new Date(row.leave_end).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '–'}
                            </div>
                        </td>
                        <td style={{ maxWidth: '200px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {row.reason || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No reason</span>}
                            </div>
                        </td>
                        <td style={{ paddingRight: '16px', textAlign: 'right' }}>
                            <ActionButtons onEdit={() => openEditModal(row)} onDelete={() => handleDelete(row.id)} />
                        </td>
                    </tr>
                )}
            />

            {/* ── Add / Edit Leave Modal ── */}
            <FormModal
                show={showModal}
                title={editItem ? 'Edit Leave Request' : 'Add Leave Request'}
                onClose={() => setShowModal(false)}
                onSubmit={handleSubmit(onSubmit)}
                isSubmitting={isSubmitting}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                    {/* Teacher selector — always shown */}
                    <div>
                        <label className="form-label">
                            Teacher <span style={{ color: 'var(--danger)' }}>*</span>
                        </label>
                        <select
                            className={`form-select ${errors.teacher_id ? 'is-invalid' : ''}`}
                            {...register('teacher_id', { required: 'Teacher is required' })}
                            disabled={!!editItem} // lock teacher in edit mode
                        >
                            <option value="">Select Teacher...</option>
                            {teachers.map(t => (
                                <option key={t.id} value={t.id}>{t.full_name}</option>
                            ))}
                        </select>
                        {errors.teacher_id && <div className="invalid-feedback">{errors.teacher_id.message}</div>}
                    </div>

                    {/* Recent history (add mode only) */}
                    {selectedTeacher && !editItem && (
                        <div className="p-3 bg-light border rounded">
                            <div className="fw-bold small mb-2 text-primary">
                                <i className="bi bi-clock-history me-1" />Recent Leave History
                            </div>
                            {teacherHistory.length > 0 ? (
                                <div style={{ maxHeight: '110px', overflowY: 'auto' }}>
                                    {teacherHistory.map(h => (
                                        <div key={h.id} className="d-flex justify-content-between align-items-center mb-1 pb-1 border-bottom" style={{ borderColor: '#e9ecef' }}>
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

                    {/* ── Leave Duration ── */}
                    {!editItem ? (
                        /* ADD mode — use toggle buttons */
                        <LeavePicker selectedDays={selectedDays} onToggle={handleDayToggle} />
                    ) : (
                        /* EDIT mode — use date pickers */
                        <div>
                            <div className="d-flex justify-content-between align-items-center mb-2">
                                <label className="form-label mb-0 fw-bold text-dark">Leave Duration</label>
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
                    )}

                    {/* Reason */}
                    <div>
                        <label className="form-label">
                            Reason <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '12px' }}>(optional)</span>
                        </label>
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

            {/* ── Monthly History Modal ── */}
            <div
                className={`modal fade ${showHistoryModal ? 'show' : ''}`}
                style={{ display: showHistoryModal ? 'block' : 'none', backgroundColor: 'rgba(0,0,0,0.5)' }}
            >
                <div className="modal-dialog modal-dialog-centered modal-lg">
                    <div className="modal-content border-0 shadow-lg rounded-4">
                        <div className="modal-header border-bottom-0 pb-0">
                            <h5 className="modal-title fw-bold text-dark">
                                <i className="bi bi-clock-history me-2 text-info" />Monthly Leave History
                            </h5>
                            <button type="button" className="btn-close" onClick={() => setShowHistoryModal(false)} />
                        </div>
                        <div className="modal-body p-4">
                            <div className="mb-4">
                                <label className="form-label fw-bold text-dark small">Select Month</label>
                                <input
                                    type="month"
                                    className="form-control border-0 bg-light"
                                    style={{ maxWidth: '250px' }}
                                    value={historyMonth}
                                    onChange={e => setHistoryMonth(e.target.value)}
                                />
                            </div>
                            <div style={{ maxHeight: '450px', overflowY: 'auto' }} className="pe-2">
                                {getLeavesForMonth().length > 0 ? (
                                    <div className="list-group">
                                        {getLeavesForMonth().map(h => (
                                            <div key={h.id} className="list-group-item border-0 shadow-sm rounded-3 mb-3 p-3">
                                                <div className="d-flex justify-content-between align-items-center mb-2">
                                                    <div className="fw-bold text-dark fs-6">
                                                        {h.teacher_name}
                                                        <span className="fw-normal text-muted small ms-1">({h.department_name})</span>
                                                    </div>
                                                    <span className={`badge ${h.status === 'approved' ? 'bg-success' : h.status === 'rejected' ? 'bg-danger' : 'bg-warning'}`}>
                                                        {h.status}
                                                    </span>
                                                </div>
                                                <div className="d-flex flex-column gap-1">
                                                    <div className="text-secondary small fw-medium">
                                                        <i className="bi bi-calendar-event text-primary me-2" />
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
                                        <i className="bi bi-calendar-x opacity-50 d-block mb-3" style={{ fontSize: '3rem' }} />
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
