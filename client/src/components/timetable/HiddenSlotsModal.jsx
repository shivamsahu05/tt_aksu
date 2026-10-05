import React from 'react';
import { toast } from 'react-toastify';
import Swal from 'sweetalert2';
import api from '../../utils/api';

const HiddenSlotsModal = ({ show, onHide, hiddenSlots, onSuccess }) => {
    if (!show) return null;

    // Group duplicates (e.g., merged sections)
    const groupedSlots = Object.values(hiddenSlots.reduce((acc, slot) => {
        const key = `${slot.day_id}_${slot.time_slot_id}_${slot.teacher_id}_${slot.subject_id}`;
        if (!acc[key]) {
            acc[key] = { ...slot, ids: [slot.id] };
        } else {
            acc[key].ids.push(slot.id);
        }
        return acc;
    }, {}));

    const handleUnhide = async (ids, subjectName, teacherName) => {
        try {
            const result = await Swal.fire({
                title: 'Unhide Slot?',
                text: `Are you sure you want to restore ${subjectName} by ${teacherName}? It will become visible in all reports.`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes, Unhide',
                confirmButtonColor: '#198754'
            });

            if (!result.isConfirmed) return;

            // Unhide all linked slots (for merged sections)
            for (const id of ids) {
                await api.patch(`/timetable/${id}/toggle-hidden`, { is_hidden: false });
            }
            
            toast.success('Slot(s) restored successfully!');
            if (onSuccess) onSuccess();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to restore slot');
        }
    };

    return (
        <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1055 }}>
            <div className="modal-dialog modal-dialog-centered modal-lg">
                <div className="modal-content shadow-lg border-0 rounded-4">
                    <div className="modal-header bg-warning bg-opacity-10 border-bottom-0 pb-0">
                        <h5 className="modal-title fw-bold text-dark d-flex align-items-center">
                            <i className="bi bi-eye-slash-fill text-warning me-2 fs-4"></i> Hidden Slots
                        </h5>
                        <button type="button" className="btn-close" onClick={onHide}></button>
                    </div>
                    <div className="modal-body p-4 pt-3">
                        <p className="text-muted small mb-4">
                            These slots are currently hidden from reports and printed timetables. They still count towards teacher workload. You can restore them below.
                        </p>
                        
                        {groupedSlots.length === 0 ? (
                            <div className="text-center py-5 bg-light rounded-4 border border-dashed">
                                <i className="bi bi-eye text-muted opacity-25" style={{ fontSize: '3rem' }}></i>
                                <p className="mt-3 text-muted fw-medium">No hidden slots found for this class.</p>
                            </div>
                        ) : (
                            <div className="table-responsive border rounded-3">
                                <table className="table table-hover align-middle mb-0">
                                    <thead className="bg-light">
                                        <tr>
                                            <th className="py-3 px-3 text-secondary">Slot / Day</th>
                                            <th className="py-3 px-3 text-secondary">Subject</th>
                                            <th className="py-3 px-3 text-secondary">Teacher</th>
                                            <th className="py-3 px-3 text-secondary text-center">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="border-top-0">
                                        {groupedSlots.map(slot => (
                                            <tr key={slot.ids[0]}>
                                                <td className="px-3 py-3">
                                                    <div className="fw-bold text-dark">{slot.day_name}</div>
                                                    <div className="text-muted small">{slot.start_time} - {slot.end_time}</div>
                                                </td>
                                                <td className="px-3 py-3">
                                                    <div className="fw-semibold text-dark">{slot.subject_code}</div>
                                                    <div className="text-muted small text-truncate" style={{ maxWidth: '200px' }} title={slot.subject_name}>
                                                        {slot.subject_name}
                                                    </div>
                                                </td>
                                                <td className="px-3 py-3">
                                                    <span className="badge bg-secondary bg-opacity-10 text-secondary border">
                                                        {slot.teacher_short_name}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-3 text-center">
                                                    <button 
                                                        className="btn btn-sm btn-outline-success rounded-pill px-3 fw-medium"
                                                        onClick={() => handleUnhide(slot.ids, slot.subject_name, slot.teacher_name)}
                                                    >
                                                        <i className="bi bi-eye me-1"></i> Unhide
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default HiddenSlotsModal;
