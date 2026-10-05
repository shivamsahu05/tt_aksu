import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import PageHeader from '../../components/common/PageHeader';
import { toast } from 'react-toastify';
import FormModal from '../../components/common/FormModal';
import DailySuggestionsModal from '../../components/timetable/DailySuggestionsModal';

const ReplacementManager = () => {
    const [replacements, setReplacements] = useState([]);
    const [leaves, setLeaves] = useState([]); // Approved leaves that might need replacements
    const [loading, setLoading] = useState(true);
    
    // For Substitute Modal
    const [isDailyModalOpen, setIsDailyModalOpen] = useState(false);
    const [isSubModalOpen, setIsSubModalOpen] = useState(false);
    const [selectedTimetableId, setSelectedTimetableId] = useState('');
    const [selectedLeaveId, setSelectedLeaveId] = useState('');
    const [selectedDayId, setSelectedDayId] = useState('');
    const [selectedSlotId, setSelectedSlotId] = useState('');
    
    const [suggestions, setSuggestions] = useState([]);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);

    const fetchData = async () => {
        try {
            setLoading(true);
            const [repRes, leavesRes] = await Promise.all([
                api.get('/replacements'),
                api.get('/leaves?status=approved')
            ]);
            setReplacements(repRes.data.data);
            setLeaves(leavesRes.data.data);
        } catch (error) {
            toast.error("Failed to load replacement data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    // Simulating clicking an affected class from an approved leave. 
    // In a full UI, expanding the leave would show the teacher's timetable for those dates.
    // For this prototype, we'll assume we know the specific slot missing.
    const handleFindSubstitute = async (leaveId, teacherId, sessionId, dayId, slotId, ttId) => {
        setSelectedLeaveId(leaveId);
        setSelectedTimetableId(ttId);
        setSelectedDayId(dayId);
        setSelectedSlotId(slotId);
        
        setIsSubModalOpen(true);
        setLoadingSuggestions(true);
        try {
            const res = await api.get(`/replacements/suggestions?session_id=${sessionId}&day_id=${dayId}&time_slot_id=${slotId}&absent_teacher_id=${teacherId}`);
            setSuggestions(res.data.data);
        } catch (error) {
            toast.error("Failed to load suggestions");
        } finally {
            setLoadingSuggestions(false);
        }
    };

    const handleAssign = async (substituteId) => {
        try {
            await api.post('/replacements', {
                leave_id: selectedLeaveId,
                substitute_teacher_id: substituteId,
                timetable_id: selectedTimetableId,
                day_id: selectedDayId,
                time_slot_id: selectedSlotId
            });
            toast.success("Substitute assigned");
            setIsSubModalOpen(false);
            fetchData();
        } catch (error) {
            toast.error(error.response?.data?.message || "Failed to assign substitute");
        }
    };

    return (
        <div>
            <div className="d-flex justify-content-between align-items-center mb-4">
                <PageHeader title="Replacement Management" subtitle="Manage class substitutions for absent teachers" icon="bi-person-lines-fill" />
                <button className="btn btn-primary shadow-sm px-4 rounded-3 d-flex align-items-center" onClick={() => setIsDailyModalOpen(true)}>
                    <i className="bi bi-magic me-2 fs-5"></i>
                    <span className="fw-medium">Auto-Suggest Substitutes</span>
                </button>
            </div>
            
            <div className="row g-4">
                <div className="col-lg-12 mb-4">
                    <div className="card border-0 shadow-sm rounded-4">
                        <div className="card-header bg-transparent border-bottom-0 py-3 px-4">
                            <h6 className="mb-0 fw-bold">Recent Assignments</h6>
                        </div>
                        <div className="card-body px-0 pt-0">
                            {loading ? (
                                <div className="text-center py-4"><div className="spinner-border text-primary"></div></div>
                            ) : replacements.length > 0 ? (
                                <div className="table-responsive">
                                    <table className="table table-hover align-middle mb-0">
                                        <thead className="table-light">
                                            <tr>
                                                <th className="ps-4">Absent Teacher</th>
                                                <th>Substitute</th>
                                                <th>Day & Time</th>
                                                <th>Status</th>
                                                <th>Date Assigned</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {replacements.map(r => (
                                                <tr key={r.id}>
                                                    <td className="ps-4">{r.absent_teacher}</td>
                                                    <td className="fw-semibold text-primary">{r.substitute_name}</td>
                                                    <td>{r.day_name} | {r.start_time?.substring(0,5)} - {r.end_time?.substring(0,5)}</td>
                                                    <td><span className={`badge bg-${r.status === 'approved' ? 'success' : 'warning'}`}>{r.status}</span></td>
                                                    <td>{new Date(r.created_at).toLocaleDateString()}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="text-center py-4 text-muted">No recent assignments found.</div>
                            )}
                        </div>
                    </div>
                </div>


            </div>

            <FormModal isOpen={isSubModalOpen} onClose={() => setIsSubModalOpen(false)} title="Suggest Substitutes" onSubmit={(e) => e.preventDefault()}>
                {loadingSuggestions ? (
                    <div className="text-center p-4"><div className="spinner-border text-primary"></div></div>
                ) : (
                    <div className="list-group">
                        {suggestions.map(s => (
                            <button key={s.id} type="button" className="list-group-item list-group-item-action d-flex justify-content-between align-items-center p-3" onClick={() => handleAssign(s.id)}>
                                <div>
                                    <div className="fw-semibold">{s.full_name}</div>
                                    <div className="small text-muted">Current Workload: {s.current_workload} classes</div>
                                </div>
                                <span className="badge bg-primary rounded-pill">Assign</span>
                            </button>
                        ))}
                        {suggestions.length === 0 && <div className="text-muted text-center p-3">No free teachers available.</div>}
                    </div>
                )}
            </FormModal>
            <DailySuggestionsModal 
                show={isDailyModalOpen} 
                onHide={() => setIsDailyModalOpen(false)} 
                onAssignSuccess={fetchData} 
            />
        </div>
    );
};

export default ReplacementManager;
