import React, { useState, useEffect } from "react";
import { toast } from "react-toastify";
import api from "../../utils/api";

const getLocalDateStr = (dateObj = new Date()) => {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const formatDateDisplay = (dateStr) => {
    if (!dateStr) return "";
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
};

const DailySuggestionsModal = ({ show, onHide, onAssignSuccess }) => {
    const [date, setDate] = useState("");
    const [loading, setLoading] = useState(false);
    const [absentTeachers, setAbsentTeachers] = useState([]);
    const [selectedSubstitutes, setSelectedSubstitutes] = useState({});
    const [assigning, setAssigning] = useState(false);
    const [dayId, setDayId] = useState(1);

    useEffect(() => {
        if (show) {
            const today = getLocalDateStr(new Date());
            setDate(today);
            fetchSuggestions(today);
        } else {
            setAbsentTeachers([]);
            setSelectedSubstitutes({});
        }
    }, [show]);

    const fetchSuggestions = async (selectedDate) => {
        if (!selectedDate) return;
        setLoading(true);
        try {
            const sessionRes = await api.get('/sessions?is_active=1');
            const sessionId = sessionRes.data.data[0]?.id || 1;

            const res = await api.get(`/replacements/daily-suggestions?date=${selectedDate}&session_id=${sessionId}`);
            setAbsentTeachers(res.data.data);
            if (res.data.day_id) setDayId(res.data.day_id);
        } catch (error) {
            toast.error("Failed to load daily suggestions");
        } finally {
            setLoading(false);
        }
    };

    const handleDateChange = (e) => {
        const newDate = e.target.value;
        setDate(newDate);
        fetchSuggestions(newDate);
    };

    const handleSetDate = (daysToAdd) => {
        const d = new Date();
        d.setDate(d.getDate() + daysToAdd);
        const newDate = getLocalDateStr(d);
        setDate(newDate);
        fetchSuggestions(newDate);
    };

    const handleSubSelect = (leaveId, classId, subId) => {
        setSelectedSubstitutes(prev => ({
            ...prev,
            [`${leaveId}-${classId}`]: subId
        }));
    };

    const handleAssign = async (leave, cls) => {
        const subId = selectedSubstitutes[`${leave.leave_id}-${cls.timetable_id}`];
        if (!subId) {
            toast.warning("Please select a substitute first");
            return;
        }

        setAssigning(true);
        try {
            toast.info("Assigning...");
            
            const payload = {
                leave_id: leave.leave_id,
                substitute_teacher_id: subId,
                timetable_id: cls.timetable_id,
                day_id: cls.day_id || dayId || 1, 
                time_slot_id: cls.time_slot_id,
                absent_teacher_id: leave.teacher_id,
                date: date
            };

            await api.post('/replacements', payload);
            toast.success("Substitute assigned successfully");
            
            fetchSuggestions(date);
            if (onAssignSuccess) onAssignSuccess();
        } catch (error) {
            toast.error(error.response?.data?.message || "Failed to assign substitute");
        } finally {
            setAssigning(false);
        }
    };

    if (!show) return null;

    return (
        <>
            <div className="modal-backdrop fade show"></div>
            <div className="modal fade show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                <div className="modal-dialog modal-xl modal-dialog-scrollable">
                    <div className="modal-content">
                        <div className="modal-header bg-light">
                            <h5 className="modal-title mb-0 fw-bold d-flex align-items-center">
                                <i className="bi bi-magic text-primary me-2"></i> Auto-Suggest Substitutes
                            </h5>
                            <button type="button" className="btn-close" onClick={onHide}></button>
                        </div>
                        <div className="modal-body bg-light bg-opacity-50">
                            <div className="card shadow-sm border-0 mb-4 rounded-4">
                                <div className="card-body p-4">
                                    <div className="row align-items-center">
                                        <div className="col-md-7">
                                            <div className="d-flex gap-2">
                                                <button className="btn btn-outline-primary" onClick={() => handleSetDate(0)}>Today</button>
                                                <button className="btn btn-outline-primary" onClick={() => handleSetDate(1)}>Tomorrow</button>
                                                <button className="btn btn-outline-primary" onClick={() => handleSetDate(2)}>Day After Tomorrow</button>
                                            </div>
                                        </div>
                                        <div className="col-md-5">
                                            <div className="d-flex align-items-center">
                                                <label className="fw-medium me-3 text-nowrap">Or select date:</label>
                                                <input type="date" className="form-control" value={date} onChange={handleDateChange} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {loading ? (
                                <div className="text-center py-5">
                                    <div className="spinner-border text-primary" role="status">
                                        <span className="visually-hidden">Loading...</span>
                                    </div>
                                    <div className="mt-3 text-muted">Analyzing timetables and finding available teachers...</div>
                                </div>
                            ) : absentTeachers.length === 0 ? (
                                <div className="text-center py-5 bg-white rounded-4 shadow-sm px-4">
                                    <i className="bi bi-emoji-smile fs-1 text-success mb-3 d-block"></i>
                                    <h5>No missing classes found!</h5>
                                    <p className="text-muted mb-2">Either no teachers are on leave on {formatDateDisplay(date)}, or all their classes are already covered.</p>
                                    <div className="mt-3 p-3 bg-light rounded-3 text-start mx-auto" style={{ maxWidth: '520px', fontSize: '13px' }}>
                                        <div className="fw-bold text-dark mb-1"><i className="bi bi-info-circle text-primary me-1"></i> How Auto-Suggest works:</div>
                                        <div className="text-muted">
                                            • Faculty must have a leave application (<strong>Pending</strong> or <strong>Approved</strong>) in the system for <strong>{formatDateDisplay(date)}</strong>.<br />
                                            • The system checks their active timetable classes for this day and finds free teachers who have matching slots and lowest workload.
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="d-flex flex-column gap-4">
                                    {absentTeachers.map(teacher => (
                                        <div key={teacher.leave_id} className="card shadow-sm border-0 rounded-4 overflow-hidden">
                                            <div className="card-header bg-white border-bottom py-3 px-4 d-flex justify-content-between align-items-center">
                                                <div>
                                                    <h6 className="mb-1 fw-bold text-danger">
                                                        <i className="bi bi-person-x-fill me-2"></i>{teacher.teacher_name} (Absent)
                                                    </h6>
                                                    <div className="small text-muted">Classes that need covering on {formatDateDisplay(date)}</div>
                                                </div>
                                                <span className="badge rounded-pill bg-danger">{teacher.missing_classes.filter(c => !c.is_replaced).length} classes pending</span>
                                            </div>
                                            <div className="card-body p-0">
                                                <div className="table-responsive">
                                                    <table className="table table-hover align-middle mb-0">
                                                        <thead className="table-light">
                                                            <tr>
                                                                <th className="ps-4">Class & Subject</th>
                                                                <th>Time Slot</th>
                                                                <th style={{ width: '40%' }}>Suggested Available Teachers</th>
                                                                <th className="pe-4 text-end">Action</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {teacher.missing_classes.map(cls => (
                                                                <tr key={cls.timetable_id} className={cls.is_replaced ? "table-success bg-opacity-25" : ""}>
                                                                    <td className="ps-4">
                                                                        <div className="fw-bold">{cls.program_name} {cls.semester} {cls.section_name}</div>
                                                                        <div className="small text-muted">{cls.subject_code} - {cls.subject_name}</div>
                                                                    </td>
                                                                    <td>
                                                                        <span className="badge bg-secondary me-2">P{cls.slot_order}</span>
                                                                        <span className="small">{cls.start_time.substring(0,5)} - {cls.end_time.substring(0,5)}</span>
                                                                    </td>
                                                                    <td>
                                                                        {cls.is_replaced ? (
                                                                            <div className="d-flex align-items-center text-success fw-medium">
                                                                                <i className="bi bi-check-circle-fill me-2"></i>
                                                                                Covered by {cls.substitute_name}
                                                                            </div>
                                                                        ) : (
                                                                            <select 
                                                                                className="form-select form-select-sm" 
                                                                                value={selectedSubstitutes[`${teacher.leave_id}-${cls.timetable_id}`] || ""}
                                                                                onChange={(e) => handleSubSelect(teacher.leave_id, cls.timetable_id, e.target.value)}
                                                                            >
                                                                                <option value="">-- Select Substitute --</option>
                                                                                {cls.suggestions.map(s => {
                                                                                    const isLabTeacher = s.designation && (s.designation.toLowerCase().includes('lab') || s.designation.toLowerCase().includes('instructor'));
                                                                                    return (
                                                                                        <option key={s.id} value={s.id} className={isLabTeacher ? 'text-success fw-bold' : 'text-primary fw-bold'}>
                                                                                            {s.full_name} (Workload: {s.current_workload}) {isLabTeacher ? '(Lab)' : '(Theory)'}
                                                                                        </option>
                                                                                    );
                                                                                })}
                                                                            </select>
                                                                        )}
                                                                    </td>
                                                                    <td className="pe-4 text-end">
                                                                        {!cls.is_replaced && (
                                                                            <button 
                                                                                className="btn btn-primary btn-sm"
                                                                                disabled={assigning || !selectedSubstitutes[`${teacher.leave_id}-${cls.timetable_id}`]}
                                                                                onClick={() => handleAssign(teacher, cls)}
                                                                            >
                                                                                Assign
                                                                            </button>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="modal-footer bg-light">
                            <button type="button" className="btn btn-secondary" onClick={onHide}>Close</button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};

export default DailySuggestionsModal;
