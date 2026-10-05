import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import PageHeader from '../../components/common/PageHeader';
import { useAuth } from '../../context/AuthContext';

const FacultyDashboard = () => {
    const { user } = useAuth();
    const [stats, setStats] = useState({ todaysClasses: [], tomorrowsClasses: [] });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const sessionRes = await api.get('/sessions');
                const activeSession = sessionRes.data.data?.find(s => s.is_active);
                let todaysClasses = [];
                let tomorrowsClasses = [];

                if (activeSession) {
                    const today = new Date();
                    const tomorrow = new Date(today);
                    tomorrow.setDate(tomorrow.getDate() + 1);

                    const todayStr = today.toISOString().split('T')[0];
                    const tomorrowStr = tomorrow.toISOString().split('T')[0];

                    const [ttToday, ttTomorrow] = await Promise.all([
                        api.get(`/timetable/daily?session_id=${activeSession.id}&date=${todayStr}`).catch(() => ({ data: { success: false } })),
                        api.get(`/timetable/daily?session_id=${activeSession.id}&date=${tomorrowStr}`).catch(() => ({ data: { success: false } }))
                    ]);

                    if (ttToday.data.success) {
                        todaysClasses = ttToday.data.data.filter(c => c.teacher_id === user?.teacher_id || c.replacement_teacher_id === user?.teacher_id);
                    }
                    if (ttTomorrow.data.success) {
                        tomorrowsClasses = ttTomorrow.data.data.filter(c => c.teacher_id === user?.teacher_id || c.replacement_teacher_id === user?.teacher_id);
                    }
                }
                
                setStats({ todaysClasses, tomorrowsClasses });
            } catch (error) {
                console.error(error);
            } finally {
                setLoading(false);
            }
        };
        fetchStats();
    }, [user]);

    const renderClassTable = (classes, title, emptyMessage) => (
        <div className="card border-0 shadow-sm rounded-4 h-100 mb-4">
            <div className="card-header bg-white border-bottom-0 py-3 px-4">
                <h6 className="mb-0 fw-bold">{title}</h6>
            </div>
            <div className="card-body px-4 pt-0">
                {classes.length > 0 ? (
                    <div className="table-responsive">
                        <table className="table table-hover align-middle">
                            <thead className="table-light">
                                <tr>
                                    <th>Time</th>
                                    <th>Class</th>
                                    <th>Subject</th>
                                    <th>Room</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {classes.map(c => {
                                    const sectionFormat = (c.total_sections === 1 && c.section_name === 'A') ? '' : `(${c.section_name})`;
                                    const isSubbing = c.replacement_teacher_id === user?.teacher_id;
                                    const isOnLeave = c.is_on_leave && c.teacher_id === user?.teacher_id;
                                    
                                    return (
                                        <tr key={c.id}>
                                            <td className="fw-semibold text-primary">{c.start_time.substring(0,5)}</td>
                                            <td>{c.program_name} {sectionFormat}</td>
                                            <td>{c.subject_name || c.subject_code}</td>
                                            <td><span className="badge bg-light text-dark border">{c.room_number}</span></td>
                                            <td>
                                                {isSubbing ? (
                                                    <span className="badge bg-info">Substitute for {c.teacher_name}</span>
                                                ) : isOnLeave ? (
                                                    c.replacement_teacher_name ? 
                                                    <span className="badge bg-warning text-dark">Engaged by {c.replacement_teacher_name}</span> :
                                                    <span className="badge bg-danger">On Leave (No Sub)</span>
                                                ) : (
                                                    <span className="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25">Regular</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="text-center py-5 text-muted">
                        <i className="bi bi-calendar-check fs-1 text-success opacity-50 mb-3 d-block"></i>
                        <p className="mb-0">{emptyMessage}</p>
                    </div>
                )}
            </div>
        </div>
    );

    if (loading) return <div className="text-center p-5"><div className="spinner-border text-primary"></div></div>;

    const todayStr = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: '2-digit', month: 'short' }).format(new Date());
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: '2-digit', month: 'short' }).format(tomorrow);

    return (
        <div>
            <PageHeader 
                title={user?.full_name || user?.name || user?.username} 
                subtitle={
                    <>
                        <span className="fw-semibold text-primary">@{user?.username}</span> 
                        <span className="text-muted ms-2">| Faculty Portal</span>
                    </>
                } 
                icon="bi-person-workspace" 
            />
            
            <div className="row g-4">
                <div className="col-12">
                    {renderClassTable(stats.todaysClasses, `My Classes Today (${todayStr})`, "You have no classes scheduled for today.")}
                </div>
                <div className="col-12">
                    {renderClassTable(stats.tomorrowsClasses, `My Classes Tomorrow (${tomorrowStr})`, "You have no classes scheduled for tomorrow.")}
                </div>
            </div>
        </div>
    );
};

export default FacultyDashboard;
