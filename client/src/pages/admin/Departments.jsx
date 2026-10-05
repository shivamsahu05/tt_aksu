import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import { toast } from 'react-toastify';
import { safeDelete, showSuccess } from '../../utils/alerts';
import FormModal from '../../components/common/FormModal';
import PageHeader from '../../components/common/PageHeader';
import DataTable from '../../components/common/DataTable';
import ActionButtons from '../../components/common/ActionButtons';
import { useForm } from 'react-hook-form';

const Departments = () => {
    const [departments, setDepartments] = useState([]);
    const [buildings, setBuildings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalRows, setTotalRows] = useState(0);
    const [showModal, setShowModal] = useState(false);
    const [editItem, setEditItem] = useState(null);

    const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm();

    const fetchDepartments = async () => {
        try {
            setLoading(true);
            const [res, bldgRes] = await Promise.all([
                api.get(`/departments?page=${page}&limit=10&search=${searchTerm}`),
                api.get('/rooms/buildings')
            ]);
            if (res.data.success) {
                setDepartments(res.data.data);
                setTotalPages(res.data.pagination.totalPages);
                setTotalRows(res.data.pagination.totalRows);
            }
            if (bldgRes.data.success) {
                setBuildings(bldgRes.data.data);
            }
        } catch (error) {
            toast.error('Failed to fetch departments');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchDepartments(); }, [page, searchTerm]);

    const handleSearch = (val) => { setSearchTerm(val); setPage(1); };

    const openAddModal = () => {
        setEditItem(null);
        reset({ name: '', short_code: '', building_id: '', is_active: true });
        setShowModal(true);
    };

    const openEditModal = (dept) => {
        setEditItem(dept);
        reset({ name: dept.name, short_code: dept.short_code, building_id: dept.building_id || '', is_active: dept.is_active === 1 });
        setShowModal(true);
    };

    const onSubmit = async (data) => {
        try {
            const payload = { ...data, is_active: data.is_active ? 1 : 0 };
            if (editItem) {
                await api.put(`/departments/${editItem.id}`, payload);
                showSuccess('Department updated successfully');
            } else {
                await api.post('/departments', payload);
                showSuccess('Department added successfully');
            }
            setShowModal(false);
            fetchDepartments();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Operation failed');
        }
    };

    const handleDelete = (id, name) => {
        safeDelete(name, async () => {
            try {
                await api.delete(`/departments/${id}`);
                showSuccess('Department deleted');
                fetchDepartments();
            } catch (error) {
                toast.error(error.response?.data?.message || 'Failed to delete');
            }
        });
    };

    const columns = [
        { label: '#', headerStyle: { width: '50px' } },
        { label: 'Department Name' },
        { label: 'Code', headerStyle: { width: '120px' } },
        { label: 'Building', headerStyle: { width: '150px' } },
        { label: 'Status', headerStyle: { width: '100px' } },
        { label: 'Actions', headerStyle: { width: '100px', textAlign: 'right' } },
    ];

    return (
        <div>
            <PageHeader
                title="Departments"
                subtitle="Manage university departments and their short codes"
                icon="bi-building-fill"
                actionButton={{ label: 'Add Department', icon: 'bi-plus-lg', onClick: openAddModal }}
            />

            <DataTable
                columns={columns}
                data={departments}
                loading={loading}
                searchTerm={searchTerm}
                onSearch={handleSearch}
                page={page}
                totalPages={totalPages}
                totalRows={totalRows}
                setPage={setPage}
                searchPlaceholder="Search departments..."
                emptyMessage="No departments have been created yet."
                emptyIcon="bi-building"
                renderRow={(dept, idx) => (
                    <tr key={dept.id}>
                        <td style={{ color: 'var(--text-muted)', fontSize: '12px', paddingLeft: '20px' }}>
                            {(page - 1) * 10 + idx + 1}
                        </td>
                        <td style={{ paddingLeft: '16px' }}>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '14px' }}>{dept.name}</div>
                        </td>
                        <td>
                            <span style={{
                                background: 'var(--primary-50)',
                                color: 'var(--primary-700)',
                                border: '1px solid var(--primary-100)',
                                borderRadius: '5px',
                                padding: '2px 8px',
                                fontSize: '11.5px',
                                fontWeight: 600,
                                fontFamily: 'monospace'
                            }}>
                                {dept.short_code}
                            </span>
                        </td>
                        <td>
                            {dept.building_name ? (
                                <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}><i className="bi bi-building me-1"></i>{dept.building_name}</span>
                            ) : (
                                <span className="text-muted" style={{ fontSize: '12.5px' }}>-</span>
                            )}
                        </td>
                        <td>
                            {dept.is_active ? (
                                <span className="badge badge-success">Active</span>
                            ) : (
                                <span className="badge badge-secondary">Inactive</span>
                            )}
                        </td>
                        <td style={{ paddingRight: '16px' }}>
                            <ActionButtons
                                onEdit={() => openEditModal(dept)}
                                onDelete={() => handleDelete(dept.id, dept.name)}
                            />
                        </td>
                    </tr>
                )}
            />

            <FormModal
                show={showModal}
                title={editItem ? 'Edit Department' : 'Add Department'}
                onClose={() => setShowModal(false)}
                onSubmit={handleSubmit(onSubmit)}
                isSubmitting={isSubmitting}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                        <label className="form-label">Department Name <span style={{ color: 'var(--danger)' }}>*</span></label>
                        <input
                            type="text"
                            className={`form-control ${errors.name ? 'is-invalid' : ''}`}
                            placeholder="e.g., Computer Science and Engineering"
                            {...register('name', { required: 'Department name is required' })}
                            autoFocus
                        />
                        {errors.name && <div className="invalid-feedback">{errors.name.message}</div>}
                    </div>

                    <div>
                        <label className="form-label">Short Code <span style={{ color: 'var(--danger)' }}>*</span></label>
                        <input
                            type="text"
                            className={`form-control ${errors.short_code ? 'is-invalid' : ''}`}
                            placeholder="e.g., CSE"
                            {...register('short_code', { required: 'Short code is required' })}
                            style={{ textTransform: 'uppercase' }}
                        />
                        {errors.short_code && <div className="invalid-feedback">{errors.short_code.message}</div>}
                        <div className="form-text">Used as a prefix in reports and timetables.</div>
                    </div>

                    <div>
                        <label className="form-label">Building / Block</label>
                        <select
                            className={`form-select ${errors.building_id ? 'is-invalid' : ''}`}
                            {...register('building_id')}
                        >
                            <option value="">Select Building (Optional)</option>
                            {buildings.map(b => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                        </select>
                        <div className="form-text">Primary building for this department's rooms.</div>
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
                            id="deptIsActive"
                            style={{ margin: 0, cursor: 'pointer' }}
                            {...register('is_active')}
                        />
                        <label htmlFor="deptIsActive" style={{ cursor: 'pointer', fontSize: '13.5px', color: 'var(--text-primary)', margin: 0 }}>
                            Department is <strong>active</strong>
                        </label>
                    </div>
                </div>
            </FormModal>
        </div>
    );
};

export default Departments;
