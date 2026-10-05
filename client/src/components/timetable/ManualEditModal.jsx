import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import Swal from 'sweetalert2';
import api from '../../utils/api';

const ManualEditModal = ({ show, onHide, entries, editMeta, timetable, departmentId, onSuccess }) => {
    const [teachers, setTeachers] = useState([]);
    const [rooms, setRooms] = useState([]);
    const [subjects, setSubjects] = useState([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const [suggestions, setSuggestions] = useState([]);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);
    const [showMoveSection, setShowMoveSection] = useState(false);
    const [selectedMoveSlot, setSelectedMoveSlot] = useState(null);

    const occupiedRoomIds = new Set();
    if (show && entries && entries.length > 0 && timetable) {
        const entry = entries[0];
        const dayId = selectedMoveSlot ? selectedMoveSlot.day_id : entry.day_id;
        const slotId = selectedMoveSlot ? selectedMoveSlot.time_slot_id : entry.time_slot_id;
        
        timetable.forEach(t => {
            if (t.day_id === dayId && t.time_slot_id === slotId && t.room_id) {
                const isCurrentEntry = entries.some(e => e.id === t.id);
                if (!isCurrentEntry) {
                    occupiedRoomIds.add(t.room_id);
                }
            }
        });
    }

    const [formData, setFormData] = useState({
        teacher_id: '',
        room_id: '',
        subject_id: '',
        is_hidden: false
    });

    useEffect(() => {
        if (show && entries && entries.length > 0) {
            fetchInitialData();
            setFormData({
                teacher_id: entries[0].teacher_id || '',
                room_id: entries[0].room_id || '',
                subject_id: entries[0].subject_id || '',
                is_hidden: entries[0].is_hidden === 1 || entries[0].is_hidden === true
            });
            setSuggestions([]);
            setShowMoveSection(false);
            setSelectedMoveSlot(null);
        }
    }, [show, entries]);

    const fetchInitialData = async () => {
        setLoading(true);
        try {
            const [teacherRes, roomRes, subjectRes] = await Promise.all([
                api.get(departmentId ? `/teachers?limit=1000&department_id=${departmentId}` : '/teachers?limit=1000'),
                api.get('/rooms?limit=1000'),
                api.get(departmentId ? `/subjects?limit=1000&department_id=${departmentId}` : '/subjects?limit=1000')
            ]);

            if (teacherRes.data.success) {
                setTeachers(teacherRes.data.data.filter(t => t.is_active === 1 || t.is_active === true));
            }
            if (roomRes.data.success) {
                setRooms(roomRes.data.data.filter(r => r.is_active === 1 || r.is_active === true));
            }
            if (subjectRes.data.success) {
                setSubjects(subjectRes.data.data.filter(s => s.is_active === 1 || s.is_active === true));
            }
        } catch (error) {
            toast.error('Failed to load required data');
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData({ ...formData, [name]: type === 'checkbox' ? checked : value });
    };

    const fetchFreeSlots = async () => {
        if (!formData.subject_id || !formData.teacher_id) {
            toast.warning('Select a subject and teacher first.');
            return;
        }
        setLoadingSuggestions(true);
        try {
            const entry = entries[0];
            const allocType = (entry.subject_type === 'lab' || (entry.subject_type === 'both' && entry.lab_group_id)) ? 'lab' : 'theory';
            const res = await api.get(`/timetable/suggestions?session_id=${entry.session_id}&section_id=${entry.section_id}&subject_id=${formData.subject_id}&teacher_id=${formData.teacher_id}&allocation_type=${allocType}&ignore_id=${entry.id}`);
            if (res.data.success) {
                setSuggestions(res.data.data || []);
            }
        } catch (error) {
            toast.error('Failed to load free slot suggestions');
        } finally {
            setLoadingSuggestions(false);
        }
    };

    const handleSubmit = async () => {
        if (!formData.teacher_id || !formData.room_id || !formData.subject_id) {
            toast.warning('Please select subject, teacher, and room.');
            return;
        }

        const moveText = selectedMoveSlot
            ? ` and move it to ${selectedMoveSlot.dayName} (${selectedMoveSlot.slotName})`
            : '';
        const result = await Swal.fire({
            title: 'Apply Manual Changes?',
            text: `You are about to manually edit ${entries.length > 1 ? 'a merged group of sections' : 'this timetable slot'}${moveText}.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Yes, Apply Changes'
        });

        if (!result.isConfirmed) return;

        await performUpdate(false);
    };

    const performUpdate = async (force = false) => {
        setSaving(true);
        try {
            for (const entry of entries) {
                const payload = {
                    subject_id: formData.subject_id,
                    teacher_id: formData.teacher_id,
                    room_id: formData.room_id,
                    day_id: selectedMoveSlot ? selectedMoveSlot.day_id : entry.day_id,
                    time_slot_id: selectedMoveSlot ? selectedMoveSlot.time_slot_id : entry.time_slot_id,
                    force: force,
                    is_hidden: formData.is_hidden
                };

                await api.put(`/timetable/${entry.id}`, payload);
            }
            toast.success('Timetable updated successfully!');
            onHide();
            if (onSuccess) onSuccess();
        } catch (error) {
            if (error.response?.status === 409 && error.response?.data?.isConflict && !force) {
                // Second Confirmation for Conflicts
                const conflictResult = await Swal.fire({
                    title: 'Conflict Detected!',
                    text: error.response.data.message + " Do you want to force this change anyway?",
                    icon: 'error',
                    showCancelButton: true,
                    confirmButtonColor: '#d33',
                    confirmButtonText: 'Yes, Force Update'
                });

                if (conflictResult.isConfirmed) {
                    await performUpdate(true);
                }
            } else {
                toast.error(error.response?.data?.message || 'Failed to update timetable slot');
            }
        } finally {
            setSaving(false);
        }
    };

    if (!show) return null;

    return (
        <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content border-0 shadow-lg">
                    <div className="modal-header bg-light border-bottom-0 flex-column align-items-start">
                        <div className="d-flex justify-content-between w-100">
                            <h5 className="modal-title fw-bold text-dark mb-1">
                                <i className="bi bi-pencil-square text-primary me-2"></i>
                                Manual Edit Slot
                            </h5>
                            <button type="button" className="btn-close" onClick={onHide}></button>
                        </div>
                        {editMeta && (
                            <div className="text-muted small mt-1 d-flex gap-3 w-100">
                                <span><i className="bi bi-calendar-day me-1"></i>{editMeta.day}</span>
                                <span><i className="bi bi-clock me-1"></i>{editMeta.time}</span>
                                <span className="text-truncate" style={{ maxWidth: '200px' }} title={editMeta.class}><i className="bi bi-people me-1"></i>{editMeta.class}</span>
                            </div>
                        )}
                    </div>
                    <div className="modal-body p-4">
                        {loading ? (
                            <div className="text-center py-4">
                                <div className="spinner-border text-primary" role="status"></div>
                                <div className="mt-2 text-muted">Loading options...</div>
                            </div>
                        ) : (
                            <div className="row g-3">
                                {entries && entries.length > 1 && (
                                    <div className="col-12">
                                        <div className="alert alert-info py-2 mb-0" style={{ fontSize: '13px' }}>
                                            <i className="bi bi-info-circle me-2"></i>
                                            Editing a merged group ({entries.length} sections). All will be updated.
                                        </div>
                                    </div>
                                )}
                                <div className="col-12">
                                    <label className="form-label fw-medium text-secondary small">Subject</label>
                                    <select className="form-select" name="subject_id" value={formData.subject_id} onChange={handleChange}>
                                        <option value="">Select Subject</option>
                                        {subjects.map(s => (
                                            <option key={s.id} value={s.id}>{s.subject_code} - {s.full_name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="col-12">
                                    <label className="form-label fw-medium text-secondary small">Teacher</label>
                                    <select className="form-select" name="teacher_id" value={formData.teacher_id} onChange={handleChange}>
                                        <option value="">Select Teacher</option>
                                        {teachers.map(t => (
                                            <option key={t.id} value={t.id}>{t.short_name} ({t.full_name}) - {t.department_code || 'General'}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="col-12">
                                    <label className="form-label fw-medium text-secondary small">Room</label>
                                    <select className="form-select" name="room_id" value={formData.room_id} onChange={handleChange}>
                                        <option value="">Select Room</option>
                                        {(() => {
                                            const groupedRooms = {};
                                            const generalRooms = [];
                                            
                                            // Filter rooms based on the class's building constraints
                                            const entryBuildingId = entries && entries.length > 0 ? entries[0].class_building_id : null;
                                            const filteredRooms = entryBuildingId ? rooms.filter(r => r.building_id === entryBuildingId) : rooms;

                                            filteredRooms.forEach(r => {
                                                if (r.department_code) {
                                                    if (!groupedRooms[r.department_code]) {
                                                        groupedRooms[r.department_code] = { department_id: r.department_id, rooms: [] };
                                                    }
                                                    groupedRooms[r.department_code].rooms.push(r);
                                                } else {
                                                    generalRooms.push(r);
                                                }
                                            });

                                            const sortedDeptCodes = Object.keys(groupedRooms).sort((a, b) => {
                                                if (departmentId) {
                                                    if (groupedRooms[a].department_id == departmentId) return -1;
                                                    if (groupedRooms[b].department_id == departmentId) return 1;
                                                }
                                                return a.localeCompare(b);
                                            });

                                            return (
                                                <>
                                                    {sortedDeptCodes.map(code => (
                                                        <optgroup key={code} label={`${code} Department Rooms`}>
                                                            {groupedRooms[code].rooms.map(r => {
                                                                const isOccupied = occupiedRoomIds.has(r.id);
                                                                return (
                                                                    <option key={r.id} value={r.id} style={{ color: isOccupied ? '#dc3545' : '#198754', fontWeight: isOccupied ? 'normal' : '500' }}>
                                                                        {r.room_number} (Cap: {r.capacity}) {isOccupied ? '[Occupied]' : '[Free]'}
                                                                    </option>
                                                                );
                                                            })}
                                                        </optgroup>
                                                    ))}
                                                    {generalRooms.length > 0 && (
                                                        <optgroup label="General Rooms">
                                                            {generalRooms.map(r => {
                                                                const isOccupied = occupiedRoomIds.has(r.id);
                                                                return (
                                                                    <option key={r.id} value={r.id} style={{ color: isOccupied ? '#dc3545' : '#198754', fontWeight: isOccupied ? 'normal' : '500' }}>
                                                                        {r.room_number} (Cap: {r.capacity}) {isOccupied ? '[Occupied]' : '[Free]'}
                                                                    </option>
                                                                );
                                                            })}
                                                        </optgroup>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </select>
                                </div>
                                <div className="col-12 mt-2">
                                    <div className="form-check form-switch p-3 bg-light rounded border border-warning border-opacity-50">
                                        <input className="form-check-input" type="checkbox" role="switch" id="isHiddenSwitch" name="is_hidden" checked={formData.is_hidden} onChange={handleChange} style={{ cursor: 'pointer' }} />
                                        <label className="form-check-label fw-bold text-dark ms-2" htmlFor="isHiddenSwitch" style={{ cursor: 'pointer' }}>
                                            <i className="bi bi-eye-slash text-warning me-2"></i>
                                            Hide this slot from Reports & Printed Timetable
                                        </label>
                                        {/* <div className="text-muted small ms-4 mt-1">This slot will appear faded in the timetable view and will be excluded from final reports. It still counts towards workload.</div> */}
                                    </div>
                                </div>
                                <div className="col-12 mt-3 border-top pt-3">
                                    <div className="d-flex justify-content-between align-items-center mb-2">
                                        <label className="form-label fw-semibold text-primary mb-0" style={{ cursor: 'pointer' }} onClick={() => setShowMoveSection(!showMoveSection)}>
                                            <i className="bi bi-arrows-move me-2"></i>
                                            Move to Another Free Slot {selectedMoveSlot ? `(Selected: ${selectedMoveSlot.dayName} ${selectedMoveSlot.slotName})` : ''}
                                        </label>
                                        <button
                                            type="button"
                                            className="btn btn-sm btn-outline-primary"
                                            onClick={() => {
                                                const next = !showMoveSection;
                                                setShowMoveSection(next);
                                                if (next && suggestions.length === 0) fetchFreeSlots();
                                            }}
                                        >
                                            {showMoveSection ? 'Hide' : 'Find Free Slots'}
                                        </button>
                                    </div>

                                    {showMoveSection && (
                                        <div className="bg-light p-3 rounded border">
                                            {loadingSuggestions ? (
                                                <div className="text-center py-2">
                                                    <span className="spinner-border spinner-border-sm text-primary me-2"></span>
                                                    <span className="small text-muted">Finding available free slots...</span>
                                                </div>
                                            ) : suggestions.length === 0 ? (
                                                <div className="text-muted small text-center py-2">
                                                    No alternative free slots found for this teacher and section.
                                                </div>
                                            ) : (
                                                <div className="d-flex flex-wrap gap-2" style={{ maxHeight: '160px', overflowY: 'auto' }}>
                                                    {suggestions.map((sugg, idx) => {
                                                        const isSelected = selectedMoveSlot?.day_id === sugg.day.id && selectedMoveSlot?.time_slot_id === sugg.slot1.id;
                                                        const slotLabel = sugg.slot2
                                                            ? `${sugg.slot1.start_time}-${sugg.slot2.end_time}`
                                                            : `${sugg.slot1.start_time}-${sugg.slot1.end_time}`;
                                                        return (
                                                            <button
                                                                key={idx}
                                                                type="button"
                                                                className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-outline-secondary'} d-flex align-items-center gap-1`}
                                                                onClick={() => {
                                                                    if (isSelected) {
                                                                        setSelectedMoveSlot(null);
                                                                    } else {
                                                                        setSelectedMoveSlot({
                                                                            day_id: sugg.day.id,
                                                                            time_slot_id: sugg.slot1.id,
                                                                            time_slot_id_2: sugg.slot2?.id || null,
                                                                            room_id: sugg.room?.id || formData.room_id,
                                                                            dayName: sugg.day.name,
                                                                            slotName: slotLabel
                                                                        });
                                                                        if (sugg.room?.id) {
                                                                            setFormData(prev => ({ ...prev, room_id: sugg.room.id }));
                                                                        }
                                                                    }
                                                                }}
                                                            >
                                                                <i className="bi bi-calendar-event"></i>
                                                                <strong>{sugg.day.name}:</strong> {slotLabel}
                                                                {sugg.room ? ` (Room ${sugg.room.room_number})` : ''}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="modal-footer border-top-0 bg-light">
                        <button type="button" className="btn btn-light border" onClick={onHide} disabled={saving}>Cancel</button>
                        <button type="button" className="btn btn-primary px-4" onClick={handleSubmit} disabled={saving || loading}>
                            {saving ? <span className="spinner-border spinner-border-sm me-2"></span> : <i className="bi bi-check2-circle me-2"></i>}
                            Save Changes
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ManualEditModal;
