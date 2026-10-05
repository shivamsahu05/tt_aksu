import React, { useEffect, useState } from 'react';
import api from '../../utils/api';
import { toast } from 'react-toastify';
import { safeDelete, showSuccess } from '../../utils/alerts';
import PageHeader from '../../components/common/PageHeader';
import DataTable from '../../components/common/DataTable';
import ActionButtons from '../../components/common/ActionButtons';
import FormModal from '../../components/common/FormModal';
import Swal from 'sweetalert2';

const TimeSlots = () => {
    const [slots, setSlots] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [selectedDept, setSelectedDept] = useState('');
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [formData, setFormData] = useState({ id: null, slot_order: '', start_time: '', end_time: '', slot_type: 'lecture', department_id: '' });
    const [isSubmitting, setIsSubmitting] = useState(false);

    const fetchSlots = async () => {
        try {
            setLoading(true);
            const res = await api.get('/timeslots');
            setSlots(res.data.data || []);
        } catch (error) {
            toast.error('Failed to fetch time slots');
        } finally {
            setLoading(false);
        }
    };



useEffect(() => {
    fetchSlots();
}, []);

const openAddModal = () => {
    setFormData({ id: null, slot_order: slots.length + 1, start_time: '', end_time: '', slot_type: 'lecture' });
    setShowModal(true);
};

const openEditModal = (slot) => {
    const isOverride = slot.department_id === null;
    setFormData({
        id: isOverride ? null : slot.id,
        slot_order: slot.slot_order,
        start_time: slot.start_time.substring(0, 5),
        end_time: slot.end_time.substring(0, 5),
        slot_type: slot.slot_type
    });
    setShowModal(true);
};

const handleSave = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
        if (formData.id) {
            await api.put(`/timeslots/${formData.id}`, formData);
            showSuccess('Time slot updated');
        } else {
            await api.post('/timeslots', formData);
            showSuccess('Time slot created');
        }
        setShowModal(false);
        fetchSlots();
    } catch (error) {
        toast.error(error.response?.data?.message || 'Error saving time slot');
    } finally {
        setIsSubmitting(false);
    }
};

const handleDelete = async (id) => {
    const result = await Swal.fire({
        title: 'Delete Time Slot?',
        text: 'This action cannot be undone.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Delete',
        cancelButtonText: 'Cancel',
    });
    if (result.isConfirmed) {
        try {
            await api.delete(`/timeslots/${id}`);
            showSuccess('Time slot deleted');
            fetchSlots();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Error deleting time slot');
        }
    }
};

const columns = [
    { label: '#', headerStyle: { width: '70px' } },
    { label: 'Time' },
    { label: 'Type', headerStyle: { width: '120px' } },
    { label: 'Actions', headerStyle: { width: '100px', textAlign: 'right' } },
];

return (
    <div>
        <PageHeader
            title="Time Slots"
            subtitle="Configure the period timings used to build the timetable grid"
            icon="bi-clock-fill"
            actionButton={{ label: 'Add Time Slot', icon: 'bi-plus-lg', onClick: openAddModal }}
        />

        <DataTable
            columns={columns}
            data={slots}
            loading={loading}
            emptyMessage="No time slots configured. Add your first period to get started."
            emptyIcon="bi-clock"
            hidePagination
            renderRow={(slot) => (
                <tr key={slot.id}>
                    <td style={{ paddingLeft: '20px' }}>
                        <div style={{
                            width: '28px', height: '28px',
                            borderRadius: '6px',
                            background: slot.slot_type === 'break' ? 'var(--warning-light)' : 'var(--primary-50)',
                            border: `1px solid ${slot.slot_type === 'break' ? 'rgba(245,158,11,0.2)' : 'var(--primary-100)'}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '11.5px', fontWeight: 700,
                            color: slot.slot_type === 'break' ? 'var(--warning-dark)' : 'var(--primary-700)'
                        }}>
                            {slot.slot_order}
                        </div>
                    </td>
                    <td>
                        <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                            {slot.start_time.substring(0, 5)} — {slot.end_time.substring(0, 5)}
                        </div>
                    </td>
                    <td>
                        {slot.slot_type === 'lecture' ? (
                            <span className="badge badge-primary">Lecture</span>
                        ) : (
                            <span className="badge badge-warning">Break</span>
                        )}
                    </td>
                    <td style={{ paddingRight: '16px', textAlign: 'right' }}>
                        <div className="d-flex align-items-center justify-content-end gap-2">
                            {slot.department_id === null && (
                                <span className="badge bg-secondary text-white" style={{ fontSize: '11px', opacity: 0.8 }}>Common</span>
                            )}
                            <ActionButtons
                                onEdit={() => openEditModal(slot)}
                                onDelete={slot.department_id === null ? undefined : () => handleDelete(slot.id)}
                            />
                        </div>
                    </td>
                </tr>
            )}
        />

        <FormModal
            show={showModal}
            title={formData.id ? 'Edit Time Slot' : 'Add Time Slot'}
            onClose={() => setShowModal(false)}
            onSubmit={handleSave}
            isSubmitting={isSubmitting}
            size="sm"
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                    <label className="form-label">Slot Order <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input
                        type="number"
                        className="form-control"
                        value={formData.slot_order}
                        onChange={e => setFormData({ ...formData, slot_order: e.target.value })}
                        required min="1"
                    />
                    <div className="form-text">Determines column order in the timetable (e.g., 1 = 1st period).</div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                        <label className="form-label">Start Time <span style={{ color: 'var(--danger)' }}>*</span></label>
                        <input
                            type="time"
                            className="form-control"
                            value={formData.start_time}
                            onChange={e => setFormData({ ...formData, start_time: e.target.value })}
                            required
                        />
                    </div>
                    <div>
                        <label className="form-label">End Time <span style={{ color: 'var(--danger)' }}>*</span></label>
                        <input
                            type="time"
                            className="form-control"
                            value={formData.end_time}
                            onChange={e => setFormData({ ...formData, end_time: e.target.value })}
                            required
                        />
                    </div>
                </div>

                <div>
                    <label className="form-label">Slot Type <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <select
                        className="form-select"
                        value={formData.slot_type}
                        onChange={e => setFormData({ ...formData, slot_type: e.target.value })}
                        required
                    >
                        <option value="lecture">Lecture / Period</option>
                        <option value="break">Break / Lunch</option>
                    </select>
                </div>
            </div>
        </FormModal>
    </div>
);
};

export default TimeSlots;
