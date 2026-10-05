import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import { toast } from 'react-toastify';
import { safeDelete, showSuccess } from '../../utils/alerts';
import PageHeader from '../../components/common/PageHeader';
import DataTable from '../../components/common/DataTable';
import ActionButtons from '../../components/common/ActionButtons';
import FormModal from '../../components/common/FormModal';
import { useForm } from 'react-hook-form';

const Sessions = () => {
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [showModal, setShowModal] = useState(false);
    const [editItem, setEditItem] = useState(null);

    const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm();

    const fetchSessions = async () => {
        try {
            setLoading(true);
            const res = await api.get(`/sessions?page=${page}&limit=10`);
            if (res.data.success) {
                setSessions(res.data.data);
                setTotalPages(res.data.pagination?.totalPages || 1);
            }
        } catch (e) {
            toast.error('Failed to fetch sessions');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchSessions(); }, [page]);

    const openAddModal = () => {
        setEditItem(null);
        reset({ name: '', start_date: '', end_date: '', is_active: false });
        setShowModal(true);
    };

    const openEditModal = (s) => {
        setEditItem(s);
        reset({
            name: s.name,
            start_date: s.start_date?.substring(0, 10),
            end_date: s.end_date?.substring(0, 10),
            is_active: s.is_active === 1
        });
        setShowModal(true);
    };

    const onSubmit = async (data) => {
        try {
            const payload = { ...data, is_active: data.is_active ? 1 : 0 };
            if (editItem) {
                await api.put(`/sessions/${editItem.id}`, payload);
                showSuccess('Session updated');
            } else {
                await api.post('/sessions', payload);
                showSuccess('Session created');
            }
            setShowModal(false);
            fetchSessions();
        } catch (e) {
            toast.error(e.response?.data?.message || 'Operation failed');
        }
    };

    const handleDelete = (id, name) => {
        safeDelete(name, async () => {
            try {
                await api.delete(`/sessions/${id}`);
                showSuccess('Session deleted');
                fetchSessions();
            } catch (e) {
                toast.error(e.response?.data?.message || 'Failed to delete');
            }
        });
    };

    const columns = [
        { label: 'Session Name' },
        { label: 'Duration' },
        { label: 'Status', headerStyle: { width: '100px' } },
        { label: 'Actions', headerStyle: { width: '100px', textAlign: 'right' } },
    ];

    return (
        <div>
            <PageHeader
                title="Academic Sessions"
                subtitle="Manage academic semesters and yearly sessions"
                icon="bi-calendar-range-fill"
                actionButton={{ label: 'New Session', icon: 'bi-plus-lg', onClick: openAddModal }}
            />

            <DataTable
                columns={columns}
                data={sessions}
                loading={loading}
                page={page}
                totalPages={totalPages}
                setPage={setPage}
                emptyMessage="No sessions found. Create your first academic session."
                emptyIcon="bi-calendar-range"
                renderRow={(s) => (
                    <tr key={s.id}>
                        <td style={{ paddingLeft: '16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <div style={{
                                    width: '36px', height: '36px',
                                    borderRadius: '8px',
                                    background: s.is_active ? 'rgba(34,197,94,0.08)' : 'var(--gray-100)',
                                    border: `1px solid ${s.is_active ? 'rgba(34,197,94,0.2)' : 'var(--app-border)'}`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: s.is_active ? 'var(--success)' : 'var(--text-muted)',
                                    fontSize: '15px'
                                }}>
                                    <i className="bi bi-calendar2"/>
                                </div>
                                <div>
                                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{s.name}</div>
                                </div>
                            </div>
                        </td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                            {s.start_date ? new Date(s.start_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '–'}
                            {' — '}
                            {s.end_date ? new Date(s.end_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '–'}
                        </td>
                        <td>
                            {s.is_active ? (
                                <span className="badge badge-success">Active</span>
                            ) : (
                                <span className="badge badge-secondary">Inactive</span>
                            )}
                        </td>
                        <td style={{ paddingRight: '16px' }}>
                            <ActionButtons
                                onEdit={() => openEditModal(s)}
                                onDelete={() => handleDelete(s.id, s.name)}
                            />
                        </td>
                    </tr>
                )}
            />

            <FormModal
                show={showModal}
                title={editItem ? 'Edit Session' : 'New Academic Session'}
                onClose={() => setShowModal(false)}
                onSubmit={handleSubmit(onSubmit)}
                isSubmitting={isSubmitting}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                        <label className="form-label">Session Name <span style={{ color: 'var(--danger)' }}>*</span></label>
                        <input
                            type="text"
                            className={`form-control ${errors.name ? 'is-invalid' : ''}`}
                            placeholder="e.g., July – December 2026"
                            {...register('name', { required: 'Session name is required' })}
                            autoFocus
                        />
                        {errors.name && <div className="invalid-feedback">{errors.name.message}</div>}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                            <label className="form-label">Start Date <span style={{ color: 'var(--danger)' }}>*</span></label>
                            <input
                                type="date"
                                className={`form-control ${errors.start_date ? 'is-invalid' : ''}`}
                                {...register('start_date', { required: 'Start date is required' })}
                            />
                            {errors.start_date && <div className="invalid-feedback">{errors.start_date.message}</div>}
                        </div>
                        <div>
                            <label className="form-label">End Date <span style={{ color: 'var(--danger)' }}>*</span></label>
                            <input
                                type="date"
                                className={`form-control ${errors.end_date ? 'is-invalid' : ''}`}
                                {...register('end_date', { required: 'End date is required' })}
                            />
                            {errors.end_date && <div className="invalid-feedback">{errors.end_date.message}</div>}
                        </div>
                    </div>

                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        padding: '12px 14px',
                        background: 'var(--app-surface-2)',
                        border: '1px solid var(--app-border)',
                        borderRadius: 'var(--radius-md)'
                    }}>
                        <input
                            className="form-check-input"
                            type="checkbox"
                            id="sessionActive"
                            style={{ margin: 0, cursor: 'pointer' }}
                            {...register('is_active')}
                        />
                        <label htmlFor="sessionActive" style={{ cursor: 'pointer', fontSize: '13.5px', color: 'var(--text-primary)', margin: 0 }}>
                            Set as <strong>active</strong> session
                            <div className="form-text" style={{ marginTop: 0 }}>Only one session should be active at a time.</div>
                        </label>
                    </div>
                </div>
            </FormModal>
        </div>
    );
};

export default Sessions;
