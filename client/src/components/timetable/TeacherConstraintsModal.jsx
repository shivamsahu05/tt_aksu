import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import api from '../../utils/api';

const TeacherConstraintsModal = ({ show, onHide, selectedDepartment }) => {
    const [teachers, setTeachers] = useState([]);
    const [days, setDays] = useState([]);
    const [timeSlots, setTimeSlots] = useState([]);

    const [selectedTeacher, setSelectedTeacher] = useState('');
    const [preferences, setPreferences] = useState([]); // Array of {day_id, time_slot_id, preference_type}
    const [allocations, setAllocations] = useState([]); // Array of teacher's assigned subjects
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const [viewHistory, setViewHistory] = useState(false);
    const [historyData, setHistoryData] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);

    useEffect(() => {
        if (show) {
            fetchInitialData();
        }
    }, [show, selectedDepartment]);

    const fetchInitialData = async () => {
        setLoading(true);
        try {
            const url = selectedDepartment ? `/teachers?limit=1000&department_id=${selectedDepartment}` : '/teachers?limit=1000';
            const [teacherRes, schemaRes] = await Promise.all([
                api.get(url),
                api.get('/timetable/schema')
            ]);

            if (teacherRes.data.success) {
                setTeachers(teacherRes.data.data.filter(t => t.is_active === 1 || t.is_active === true));
            }
            if (schemaRes.data.success) {
                setDays(schemaRes.data.data.days);
                setTimeSlots(schemaRes.data.data.slots.filter(s => s.slot_type !== 'break'));
            }
        } catch (error) {
            toast.error('Failed to load required data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (selectedTeacher) {
            fetchPreferencesAndAllocations();
        } else {
            setPreferences([]);
            setAllocations([]);
        }
    }, [selectedTeacher]);

    const fetchPreferencesAndAllocations = async () => {
        try {
            const [prefRes, allocRes] = await Promise.all([
                api.get(`/teachers/preferences/${selectedTeacher}`),
                api.get(`/allocations?teacher_id=${selectedTeacher}`)
            ]);
            if (prefRes.data.success) setPreferences(prefRes.data.data);
            if (allocRes.data.success) setAllocations(allocRes.data.data);
        } catch (error) {
            toast.error('Failed to load teacher data');
        }
    };

    const handleCellClick = (dayId, slotId) => {
        if (!selectedTeacher) {
            toast.warning('Please select a teacher first');
            return;
        }

        const existingIndex = preferences.findIndex(p => p.day_id === dayId && p.time_slot_id === slotId);
        let newPrefs = [...preferences];

        if (existingIndex > -1) {
            const currentType = newPrefs[existingIndex].preference_type;
            if (currentType === 'preferred') {
                newPrefs[existingIndex].preference_type = 'unavailable';
            } else if (currentType === 'unavailable') {
                newPrefs.splice(existingIndex, 1); // remove
            }
        } else {
            newPrefs.push({ day_id: dayId, time_slot_id: slotId, preference_type: 'preferred' });
        }
        setPreferences(newPrefs);
    };

    const handleSave = async () => {
        if (!selectedTeacher) return;
        setSaving(true);
        try {
            const res = await api.post(`/teachers/preferences/${selectedTeacher}`, { preferences });
            if (res.data.success) {
                toast.success('Teacher preferences saved successfully!');
                onHide();
            }
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to save preferences');
        } finally {
            setSaving(false);
        }
    };

    const getCellClass = (dayId, slotId) => {
        const pref = preferences.find(p => p.day_id === dayId && p.time_slot_id === slotId);
        if (!pref) return 'bg-light text-muted';
        if (pref.preference_type === 'preferred') return 'bg-success text-white fw-bold';
        if (pref.preference_type === 'unavailable') return 'bg-danger text-white fw-bold';
        return 'bg-light';
    };

    const getCellLabel = (dayId, slotId) => {
        const pref = preferences.find(p => p.day_id === dayId && p.time_slot_id === slotId);
        if (!pref) return 'Available';
        if (pref.preference_type === 'preferred') return 'Preferred';
        if (pref.preference_type === 'unavailable') return 'Unavailable';
        return 'Available';
    };

    const handleViewHistory = async () => {
        if (!viewHistory) {
            setHistoryLoading(true);
            try {
                const url = selectedDepartment ? `/teachers/department/${selectedDepartment}/preferences` : '/teachers/department/all/preferences';
                const res = await api.get(url);
                if (res.data.success) {
                    setHistoryData(res.data.data);
                }
            } catch (error) {
                toast.error('Failed to load history');
            } finally {
                setHistoryLoading(false);
            }
        }
        setViewHistory(!viewHistory);
    };

    if (!show) return null;

    return (
        <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex="-1">
            <div className="modal-dialog modal-xl modal-dialog-centered">
                <div className="modal-content">
                    <div className="modal-header align-items-center">
                        <h5 className="modal-title"><i className="bi bi-person-lines-fill me-2"></i>Teacher Priority & Constraints</h5>
                        <div className="ms-auto d-flex align-items-center gap-3">
                            <button type="button" className={`btn btn-sm ${viewHistory ? 'btn-primary' : 'btn-outline-primary'}`} onClick={handleViewHistory}>
                                <i className="bi bi-clock-history me-1"></i> {viewHistory ? 'Back to Editor' : 'View History'}
                            </button>
                            <button type="button" className="btn-close m-0" onClick={onHide}></button>
                        </div>
                    </div>
                    <div className="modal-body">
                        {loading ? (
                            <div className="text-center py-5">
                                <div className="spinner-border text-primary" role="status">
                                    <span className="visually-hidden">Loading...</span>
                                </div>
                            </div>
                        ) : viewHistory ? (
                            <div>
                                {historyLoading ? (
                                    <div className="text-center py-5"><div className="spinner-border text-primary" role="status"></div></div>
                                ) : (
                                    <div className="table-responsive">
                                        <table className="table table-bordered table-striped align-middle">
                                            <thead className="table-light">
                                                <tr>
                                                    <th>Teacher</th>
                                                    <th>Designation</th>
                                                    <th>Preferred Slots</th>
                                                    <th>Unavailable Slots</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {Object.entries(historyData.reduce((acc, curr) => {
                                                    if (!acc[curr.teacher_id]) {
                                                        acc[curr.teacher_id] = { name: curr.full_name, designation: curr.designation, preferred: [], unavailable: [] };
                                                    }
                                                    const day = days.find(d => d.id === curr.day_id)?.name || '';
                                                    const slot = timeSlots.find(s => s.id === curr.time_slot_id);
                                                    const slotLabel = slot ? `${slot.start_time.slice(0,5)}-${slot.end_time.slice(0,5)}` : '';
                                                    const entry = `${day} (${slotLabel})`;
                                                    
                                                    if (curr.preference_type === 'preferred') acc[curr.teacher_id].preferred.push(entry);
                                                    if (curr.preference_type === 'unavailable') acc[curr.teacher_id].unavailable.push(entry);
                                                    
                                                    return acc;
                                                }, {})).map(([teacherId, data]) => (
                                                    <tr key={teacherId}>
                                                        <td className="fw-bold text-primary">{data.name}</td>
                                                        <td>{data.designation || 'Faculty'}</td>
                                                        <td>
                                                            {data.preferred.length > 0 ? (
                                                                <div className="d-flex flex-wrap gap-1">
                                                                    {data.preferred.map((p, i) => <span key={i} className="badge bg-success bg-opacity-75 text-white">{p}</span>)}
                                                                </div>
                                                            ) : <span className="text-muted small">None</span>}
                                                        </td>
                                                        <td>
                                                            {data.unavailable.length > 0 ? (
                                                                <div className="d-flex flex-wrap gap-1">
                                                                    {data.unavailable.map((p, i) => <span key={i} className="badge bg-danger bg-opacity-75 text-white">{p}</span>)}
                                                                </div>
                                                            ) : <span className="text-muted small">None</span>}
                                                        </td>
                                                    </tr>
                                                ))}
                                                {historyData.length === 0 && (
                                                    <tr>
                                                        <td colSpan="4" className="text-center py-4 text-muted">No constraints or preferences found in this department.</td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div>
                                <div className="alert alert-warning d-flex align-items-center mb-4 shadow-sm border-0 border-start border-4 border-warning" role="alert" style={{ backgroundColor: '#fff3cd', color: '#664d03' }}>
                                    <i className="bi bi-exclamation-triangle-fill fs-4 me-3 text-warning flex-shrink-0"></i>
                                    <div>
                                        <strong>Note: </strong>
                                        <span>Only 3–4 teachers per department can mark themselves as unavailable. If too many teachers mark unavailable for the same slot, it will cause scheduling issues.</span>
                                    </div>
                                </div>
                                <div className="row mb-4 align-items-end">
                                    <div className="col-md-5">
                                        <label className="form-label fw-bold">Select Teacher</label>
                                        <select
                                            value={selectedTeacher}
                                            onChange={(e) => setSelectedTeacher(e.target.value)}
                                            className="form-select form-select-lg"
                                        >
                                            <option value="">-- Choose a Teacher --</option>
                                            {teachers.map(t => (
                                                <option key={t.id} value={t.id}>{t.full_name} ({t.designation || 'Teacher'})</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="col-md-7 text-start text-md-end mt-2 mt-md-0">
                                        <div className="d-flex flex-wrap justify-content-start justify-content-md-end gap-2 align-items-center">
                                            <span className="badge bg-light text-dark border p-2 text-nowrap"><i className="bi bi-circle-fill text-muted me-1"></i> Available</span>
                                            <span className="badge bg-success p-2 text-nowrap"><i className="bi bi-circle-fill text-white me-1"></i> Preferred</span>
                                            <span className="badge bg-danger p-2 text-nowrap"><i className="bi bi-circle-fill text-white me-1"></i> Unavailable</span>
                                        </div>
                                        <div className="small text-muted mt-2">
                                            Click slots to cycle: <b>Available &rarr; Preferred &rarr; Unavailable &rarr; Available</b>
                                        </div>
                                    </div>
                                </div>

                                {selectedTeacher ? (
                                    <>
                                        <div className="mb-3 p-3 bg-light rounded border">
                                            <h6 className="mb-2 text-primary"><i className="bi bi-briefcase me-2"></i>Assigned Workload / Subjects</h6>
                                            {allocations.length === 0 ? (
                                                <div className="text-muted small">No subjects assigned to this teacher yet.</div>
                                            ) : (
                                                <div className="d-flex flex-wrap gap-2">
                                                    {allocations.map(alloc => (
                                                        <div key={alloc.id} className="badge bg-white text-dark border p-2 text-start" style={{ minWidth: '200px' }}>
                                                            <div className="fw-bold">{alloc.subject_name} <span className="text-muted small">({alloc.subject_code})</span></div>
                                                            <div className="small mt-1 text-primary">
                                                                <i className="bi bi-mortarboard me-1"></i>
                                                                {alloc.program_name} ({alloc.semester}) - Sec {alloc.section_name}
                                                            </div>
                                                            <div className="small text-muted mt-1">
                                                                <span className="badge bg-secondary opacity-75">{alloc.allocation_type.toUpperCase()}</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <div className="table-responsive border rounded" style={{ overflowX: 'auto', width: '100%' }}>
                                            <table className="table table-bordered text-center align-middle mb-0" style={{ tableLayout: 'fixed', minWidth: '1050px' }}>
                                                <thead className="bg-light">
                                                    <tr>
                                                        <th style={{ width: '120px', minWidth: '110px', whiteSpace: 'nowrap' }}>Day \\ Time</th>
                                                        {timeSlots.map(slot => (
                                                            <th key={slot.id} className="small text-nowrap px-2" style={{ minWidth: '115px', whiteSpace: 'nowrap' }}>
                                                                {slot.start_time.slice(0, 5)} - {slot.end_time.slice(0, 5)}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {days.map(day => (
                                                        <tr key={day.id}>
                                                            <th className="bg-light text-start ps-3" style={{ whiteSpace: 'nowrap' }}>{day.name}</th>
                                                            {timeSlots.map(slot => (
                                                                <td
                                                                    key={slot.id}
                                                                    className={`cursor-pointer transition-all ${getCellClass(day.id, slot.id)}`}
                                                                    onClick={() => handleCellClick(day.id, slot.id)}
                                                                    style={{ cursor: 'pointer', userSelect: 'none', transition: 'all 0.2s ease', whiteSpace: 'nowrap' }}
                                                                >
                                                                    <div className="small">{getCellLabel(day.id, slot.id)}</div>
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-center py-5 bg-light rounded text-muted">
                                        <i className="bi bi-person-badge fs-1 d-block mb-3"></i>
                                        <h5>Select a teacher to configure their preferences</h5>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="modal-footer bg-light">
                        <button type="button" className="btn btn-outline-secondary" onClick={onHide}>Close</button>
                        {!viewHistory && (
                            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={!selectedTeacher || saving}>
                                {saving ? <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> : <i className="bi bi-save me-1"></i>} Save Preferences
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TeacherConstraintsModal;
