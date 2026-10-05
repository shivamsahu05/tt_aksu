import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import PageHeader from '../../components/common/PageHeader';
import { toast } from 'react-toastify';
import FormModal from '../../components/common/FormModal';

const STATUS_BADGE = {
    approved: <span className="badge badge-success">Approved</span>,
    rejected: <span className="badge badge-danger">Rejected</span>,
    canceled:  <span className="badge badge-secondary">Canceled</span>,
    pending:  <span className="badge badge-warning">Pending</span>,
};

const LeaveApplication = () => {
    const [leaves, setLeaves] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState({ leave_start: '', leave_end: '', reason: '' });

    const fetchLeaves = async () => {
        try {
            setLoading(true);
            const res = await api.get('/leaves');
            if (res.data.success) setLeaves(res.data.data);
        } catch (error) {
            toast.error('Failed to fetch leaves');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchLeaves(); }, []);

    const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            const res = await api.post('/leaves', formData);
            if (res.data.success) {
                toast.success('Leave applied successfully');
                setIsModalOpen(false);
                setFormData({ leave_start: '', leave_end: '', reason: '' });
                fetchLeaves();
            }
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to apply leave');
        } finally {
            setIsSubmitting(false);
        }
    };

    const activeLeaves = leaves.filter(l => l.status === 'pending' || l.status === 'approved');

    return (
        <div>
            <PageHeader
                title="Leave Application"
                subtitle="Apply for leave and track the status of your requests"
                icon="bi-calendar-minus-fill"
                actionButton={{ label: 'Apply for Leave', icon: 'bi-plus-lg', onClick: () => setIsModalOpen(true) }}
            />

            {/* Status Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '24px' }}>
                {[
                    { label: 'Total Applied', value: leaves.length, color: 'indigo', icon: 'bi-calendar2' },
                    { label: 'Pending', value: leaves.filter(l => l.status === 'pending').length, color: 'amber', icon: 'bi-hourglass-split' },
                    { label: 'Approved', value: leaves.filter(l => l.status === 'approved').length, color: 'green', icon: 'bi-check-circle' },
                    { label: 'Rejected', value: leaves.filter(l => l.status === 'rejected').length, color: 'red', icon: 'bi-x-circle' },
                ].map(card => (
                    <div key={card.label} className="stat-card">
                        <div className="stat-card-label">{card.label}</div>
                        <div className="stat-card-value">{card.value}</div>
                    </div>
                ))}
            </div>

            {/* Leave History */}
            <div style={{
                background: 'var(--app-surface)',
                border: '1px solid var(--app-border)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-sm)',
                overflow: 'hidden'
            }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--app-border-2)' }}>
                    <div style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>Leave History</div>
                </div>

                {loading ? (
                    <div style={{ padding: '40px', textAlign: 'center' }}>
                        <div style={{ width: '32px', height: '32px', border: '3px solid var(--app-border)', borderTopColor: 'var(--primary-600)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto' }}/>
                        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                    </div>
                ) : leaves.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state-icon"><i className="bi bi-calendar-x"/></div>
                        <div className="empty-state-title">No leave requests</div>
                        <p className="empty-state-text">You have not applied for any leave yet.</p>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table className="table table-hover" style={{ marginBottom: 0 }}>
                            <thead>
                                <tr>
                                    <th style={{ paddingLeft: '20px' }}>Leave Period</th>
                                    <th>Applied On</th>
                                    <th>Reason</th>
                                    <th>Status</th>
                                    <th>Reviewed By</th>
                                </tr>
                            </thead>
                            <tbody>
                                {leaves.map(leave => (
                                    <tr key={leave.id}>
                                        <td style={{ paddingLeft: '20px' }}>
                                            <div style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-primary)' }}>
                                                {leave.leave_start ? new Date(leave.leave_start).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                                            </div>
                                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                                to {leave.leave_end ? new Date(leave.leave_end).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                                            </div>
                                        </td>
                                        <td style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                            {leave.applied_at ? new Date(leave.applied_at).toLocaleDateString('en-IN') : '—'}
                                        </td>
                                        <td style={{ maxWidth: '220px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {leave.reason || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No reason</span>}
                                            </div>
                                        </td>
                                        <td>{STATUS_BADGE[leave.status] || STATUS_BADGE.pending}</td>
                                        <td style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                                            {leave.approver_name || '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <FormModal
                show={isModalOpen}
                title="Apply for Leave"
                onClose={() => setIsModalOpen(false)}
                onSubmit={handleSubmit}
                isSubmitting={isSubmitting}
                submitLabel="Submit Application"
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{
                        display: 'flex', gap: '8px', padding: '10px 12px',
                        background: 'var(--info-light)', border: '1px solid rgba(59,130,246,0.2)',
                        borderRadius: 'var(--radius-sm)', fontSize: '12.5px', color: 'var(--info-dark)'
                    }}>
                        <i className="bi bi-info-circle" style={{ marginTop: '1px', flexShrink: 0 }}/>
                        Your leave request will be sent to your HOD for approval.
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                            <label className="form-label">Start Date <span style={{ color: 'var(--danger)' }}>*</span></label>
                            <input
                                type="date"
                                className="form-control"
                                name="leave_start"
                                value={formData.leave_start}
                                onChange={handleChange}
                                required
                            />
                        </div>
                        <div>
                            <label className="form-label">End Date <span style={{ color: 'var(--danger)' }}>*</span></label>
                            <input
                                type="date"
                                className="form-control"
                                name="leave_end"
                                value={formData.leave_end}
                                onChange={handleChange}
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="form-label">
                            Reason <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '12px' }}>(optional)</span>
                        </label>
                        <textarea
                            className="form-control"
                            name="reason"
                            rows="4"
                            placeholder="Describe the reason for your leave..."
                            value={formData.reason}
                            onChange={handleChange}
                            style={{ resize: 'none' }}
                        />
                    </div>
                </div>
            </FormModal>
        </div>
    );
};

export default LeaveApplication;
