import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import api from '../../utils/api';

const UnassignedWorkloadsModal = ({ show, onHide, selectedSession, selectedDepartment, onAssign }) => {
    const [workloads, setWorkloads] = useState([]);
    const [loading, setLoading] = useState(false);
    const [suggestionsLoading, setSuggestionsLoading] = useState({});
    const [suggestions, setSuggestions] = useState({});
    const [assigning, setAssigning] = useState(false);
    const [expandedId, setExpandedId] = useState(null);

    useEffect(() => {
        if (show && selectedSession) {
            fetchUnassigned();
        }
    }, [show, selectedSession, selectedDepartment]);

    const fetchUnassigned = async () => {
        setLoading(true);
        try {
            const url = selectedDepartment 
                ? `/timetable/unassigned?session_id=${selectedSession}&department_id=${selectedDepartment}`
                : `/timetable/unassigned?session_id=${selectedSession}`;
            const res = await api.get(url);
            if (res.data.success) {
                setWorkloads(res.data.data);
            }
        } catch (error) {
            toast.error('Failed to load unassigned workloads');
        } finally {
            setLoading(false);
        }
    };

    const handleFindSlots = async (workload) => {
        setSuggestionsLoading(prev => ({ ...prev, [workload.id]: true }));
        try {
            const res = await api.get(`/timetable/suggestions?session_id=${selectedSession}&section_id=${workload.section_id}&subject_id=${workload.subject_id}&teacher_id=${workload.teacher_id}&allocation_type=${workload.allocation_type}`);
            if (res.data.success) {
                setSuggestions(prev => ({ ...prev, [workload.id]: res.data.data }));
            }
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to find suggestions');
        } finally {
            setSuggestionsLoading(prev => ({ ...prev, [workload.id]: false }));
        }
    };

    const handleAssign = async (workload, suggestion) => {
        setAssigning(true);
        try {
            if (workload.allocation_type === 'theory') {
                const payload = {
                    session_id: selectedSession,
                    section_id: workload.section_id,
                    subject_id: workload.subject_id,
                    teacher_id: workload.teacher_id,
                    room_id: suggestion.room.id,
                    day_id: suggestion.day.id,
                    time_slot_id: suggestion.slot1.id
                };
                await api.post('/timetable', payload);
            } else {
                const payload1 = {
                    session_id: selectedSession,
                    section_id: workload.section_id,
                    subject_id: workload.subject_id,
                    teacher_id: workload.teacher_id,
                    room_id: suggestion.room.id,
                    day_id: suggestion.day.id,
                    time_slot_id: suggestion.slot1.id
                };
                const payload2 = {
                    ...payload1,
                    time_slot_id: suggestion.slot2.id
                };
                await api.post('/timetable', payload1);
                await api.post('/timetable', payload2);
            }

            toast.success('Subject assigned successfully!');
            fetchUnassigned();
            if (onAssign) onAssign();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to assign slot');
        } finally {
            setAssigning(false);
        }
    };

    if (!show) return null;

    return (
        <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex="-1">
            <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
                <div className="modal-content shadow-lg border-0">
                    <div className="modal-header bg-light">
                        <h5 className="modal-title text-primary fw-bold">
                            <i className="bi bi-magic me-2"></i> Unassigned Workloads & Suggestions
                        </h5>
                        <button type="button" className="btn-close" onClick={onHide}></button>
                    </div>
                    
                    <div className="modal-body bg-light p-4">
                        <p className="text-muted mb-4">
                            Below are subjects that have been allocated to teachers but are missing from the generated timetable. You can use the AI to find 100% conflict-free slots for them.
                        </p>

                        {loading ? (
                            <div className="text-center py-5">
                                <div className="spinner-border text-primary" role="status">
                                    <span className="visually-hidden">Loading...</span>
                                </div>
                                <p className="mt-3 text-muted">Scanning allocations...</p>
                            </div>
                        ) : workloads.length === 0 ? (
                            <div className="text-center py-5 bg-white rounded border border-success">
                                <i className="bi bi-check-circle-fill text-success fs-1 d-block mb-3"></i>
                                <h5>All workloads are scheduled!</h5>
                                <p className="text-muted">No unassigned subjects found for this session/department.</p>
                            </div>
                        ) : (
                            <div className="accordion">
                                {workloads.map((w) => {
                                    const isExpanded = expandedId === w.id;
                                    return (
                                        <div key={w.id} className="accordion-item mb-3 border rounded shadow-sm overflow-hidden">
                                            <h2 className="accordion-header">
                                                <button 
                                                    className={`accordion-button ${!isExpanded ? 'collapsed' : ''}`} 
                                                    type="button" 
                                                    onClick={() => setExpandedId(isExpanded ? null : w.id)}
                                                    style={{ backgroundColor: isExpanded ? '#f8f9fa' : 'white', boxShadow: 'none' }}
                                                >
                                                    <div className="d-flex w-100 justify-content-between align-items-center me-3">
                                                        <div>
                                                            <div className="fw-bold text-dark text-start">{w.subject_name} ({w.subject_code})</div>
                                                            <div className="small text-muted mt-1 text-start">
                                                                <i className="bi bi-person-badge me-1"></i> {w.teacher_name} &bull; 
                                                                <i className="bi bi-mortarboard ms-2 me-1"></i> {w.program_name} {w.semester} ({w.section_name})
                                                            </div>
                                                        </div>
                                                        <div className="text-end">
                                                            <span className={`badge me-2 text-uppercase text-dark bg-${w.allocation_type === 'theory' ? 'info' : 'warning'}`}>
                                                                {w.allocation_type}
                                                            </span>
                                                            <span className="badge bg-danger">
                                                                Missing {w.allocation_type === 'theory' ? (w.weekly_lectures - w.scheduled_count) : (w.weekly_practicals - w.scheduled_count)} slots
                                                            </span>
                                                        </div>
                                                    </div>
                                                </button>
                                            </h2>
                                            
                                            {isExpanded && (
                                                <div className="accordion-collapse collapse show bg-white">
                                                    <div className="accordion-body">
                                                        <div className="d-flex justify-content-between align-items-center mb-3">
                                                            <span className="fw-bold text-primary">Smart Suggestions</span>
                                                            <button 
                                                                className="btn btn-outline-primary btn-sm"
                                                                onClick={() => handleFindSlots(w)}
                                                                disabled={suggestionsLoading[w.id]}
                                                            >
                                                                {suggestionsLoading[w.id] ? (
                                                                    <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                                                                ) : (
                                                                    <i className="bi bi-search me-1"></i>
                                                                )}
                                                                Find Conflict-Free Slots
                                                            </button>
                                                        </div>

                                                        {suggestions[w.id] && (
                                                            suggestions[w.id].length === 0 ? (
                                                                <div className="alert alert-warning py-2 mb-0">
                                                                    <i className="bi bi-exclamation-triangle me-2"></i> No conflict-free slots could be found. The teacher or class might be completely busy, or there are no available rooms.
                                                                </div>
                                                            ) : (
                                                                <ul className="list-group list-group-flush border rounded">
                                                                    {suggestions[w.id].slice(0, 10).map((sug, i) => ( // show top 10
                                                                        <li key={i} className="list-group-item d-flex justify-content-between align-items-center py-3">
                                                                            <div>
                                                                                <div className="fw-bold text-dark"><i className="bi bi-calendar-event me-2 text-primary"></i>{sug.day.name}</div>
                                                                                <div className="small text-muted mt-1">
                                                                                    <i className="bi bi-clock me-1"></i> 
                                                                                    {w.allocation_type === 'theory' 
                                                                                        ? `${sug.slot1.start_time.slice(0,5)} - ${sug.slot1.end_time.slice(0,5)}`
                                                                                        : `${sug.slot1.start_time.slice(0,5)} - ${sug.slot2.end_time.slice(0,5)} (Consecutive)`
                                                                                    }
                                                                                    <span className="ms-3"><i className="bi bi-geo-alt me-1"></i> Room {sug.room.room_number}</span>
                                                                                </div>
                                                                            </div>
                                                                            <button className="btn btn-success btn-sm" onClick={() => handleAssign(w, sug)} disabled={assigning}>
                                                                                {assigning ? <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> : 'Assign Here'}
                                                                            </button>
                                                                        </li>
                                                                    ))}
                                                                    {suggestions[w.id].length > 10 && (
                                                                        <li className="list-group-item text-center text-muted small bg-light">
                                                                            And {suggestions[w.id].length - 10} more options available...
                                                                        </li>
                                                                    )}
                                                                </ul>
                                                            )
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default UnassignedWorkloadsModal;
