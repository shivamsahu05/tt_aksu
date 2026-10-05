import React, { useEffect, useState } from 'react';
import api from '../../utils/api';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const STAT_CARDS = [
    { key: 'departments',    label: 'Departments',     icon: 'bi-building-fill',      gradient: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', shadow: 'rgba(99,102,241,0.3)' },
    { key: 'teachers',       label: 'Teachers',         icon: 'bi-person-badge-fill',  gradient: 'linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)', shadow: 'rgba(14,165,233,0.3)' },
    { key: 'theory_rooms',   label: 'Theory Rooms',     icon: 'bi-easel2',             gradient: 'linear-gradient(135deg, #a855f7 0%, #c084fc 100%)', shadow: 'rgba(168,85,247,0.3)' },
    { key: 'lab_rooms',      label: 'Lab Rooms',        icon: 'bi-pc-display',         gradient: 'linear-gradient(135deg, #14b8a6 0%, #2dd4bf 100%)', shadow: 'rgba(20,184,166,0.3)' },
    { key: 'available_rooms',label: 'Free Theory Rooms',icon: 'bi-door-open-fill',     gradient: 'linear-gradient(135deg, #22c55e 0%, #4ade80 100%)', shadow: 'rgba(34,197,94,0.3)', sub: 'Unassigned' },
    { key: 'occupied_rooms', label: 'Assigned Rooms',   icon: 'bi-door-closed-fill',   gradient: 'linear-gradient(135deg, #f97316 0%, #fb923c 100%)', shadow: 'rgba(249,115,22,0.3)', sub: 'Home Rooms' },
    { key: 'free_teachers',  label: 'Free Teachers',    icon: 'bi-person-check-fill',  gradient: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)', shadow: 'rgba(16,185,129,0.3)', sub: 'Zero Workload' },
    { key: 'teachers_on_leave', label: 'Teachers on Leave (Today)', icon: 'bi-exclamation-triangle-fill', gradient: 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)', shadow: 'rgba(239,68,68,0.3)',  sub: 'Needs substitution' },
];

const StatCard = ({ config, value }) => {
    const [isHovered, setIsHovered] = useState(false);

    return (
        <div 
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            style={{
                background: 'var(--app-surface)',
                border: '1px solid var(--app-border)',
                borderBottom: isHovered ? '1px solid transparent' : '1px solid var(--app-border)',
                borderRadius: '16px',
                padding: '20px',
                boxShadow: isHovered 
                    ? `0 14px 30px -8px ${config.shadow}, 0 4px 12px -4px ${config.shadow}` 
                    : 'var(--shadow-sm)',
                transition: 'all 250ms cubic-bezier(0.4, 0, 0.2, 1)',
                height: '100%',
                position: 'relative',
                overflow: 'hidden',
                transform: isHovered ? 'translateY(-4px)' : 'translateY(0)',
                cursor: 'pointer'
            }}
        >
            {/* Bottom Accent Border Color Effect on Hover (looks stunning in both dark & light mode) */}
            <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: '3.5px',
                background: config.gradient,
                opacity: isHovered ? 1 : 0,
                transform: isHovered ? 'scaleX(1)' : 'scaleX(0)',
                transformOrigin: 'center',
                transition: 'all 280ms cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: `0 -2px 10px ${config.shadow}`
            }}/>

            {/* Gradient background blob */}
            <div style={{
                position: 'absolute', top: '-20px', right: '-20px',
                width: '90px', height: '90px', borderRadius: '50%',
                background: config.gradient,
                opacity: isHovered ? 0.16 : 0.08,
                filter: 'blur(12px)',
                transition: 'opacity 250ms ease'
            }}/>

            {/* Icon */}
            <div style={{
                width: '44px', height: '44px',
                borderRadius: '12px',
                background: config.gradient,
                boxShadow: `0 6px 18px ${config.shadow}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: '18px',
                marginBottom: '16px',
                flexShrink: 0
            }}>
                <i className={`bi ${config.icon}`}/>
            </div>

            {/* Label */}
            <div style={{
                fontSize: '11.5px', fontWeight: 600, letterSpacing: '0.06em',
                textTransform: 'uppercase', color: 'var(--text-muted)',
                marginBottom: '6px'
            }}>
                {config.label}
            </div>

            {/* Value */}
            <div style={{
                fontFamily: 'Outfit, sans-serif',
                fontSize: '32px', fontWeight: 700,
                color: 'var(--text-primary)',
                lineHeight: 1,
                marginBottom: config.sub ? '6px' : 0
            }}>
                {value ?? <span style={{ fontSize: '20px', opacity: 0.3 }}>—</span>}
            </div>

            {/* Sub label */}
            {config.sub && (
                <div style={{
                    fontSize: '11.5px', color: 'var(--text-muted)',
                    display: 'flex', alignItems: 'center', gap: '4px'
                }}>
                    <span style={{
                        display: 'inline-block', width: '6px', height: '6px',
                        borderRadius: '50%', background: config.gradient.includes('22c55e') || config.gradient.includes('10b981') ? 'var(--success)' : config.gradient.includes('ef4444') ? 'var(--danger)' : '#f97316'
                    }}/>
                    {config.sub}
                </div>
            )}
        </div>
    );
};

const Dashboard = () => {
    const { user } = useAuth();
    const isDeptAdmin = user?.role === 'DEPARTMENT_ADMIN';
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [leavesDateFilter, setLeavesDateFilter] = useState('Today');
    const [leavesDepartmentFilter, setLeavesDepartmentFilter] = useState('');

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const res = await api.get('/dashboard/stats');
                if (res.data.success) setStats(res.data.data);
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchStats();
    }, []);

    const s = stats?.stats || {};

    // Filter absent classes by Day Name (safest for timezones)
    const todayDayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    
    const filteredAbsentClasses = (() => {
        const raw = stats?.absentClasses?.filter(c => {
            const isTodayMatch = leavesDateFilter === 'Today' ? c.is_today === 1 : c.is_today === 0;
            const isDeptMatch = !leavesDepartmentFilter || c.department_id === Number(leavesDepartmentFilter);
            return isTodayMatch && isDeptMatch;
        }) || [];
        // Deduplicate
        const seen = new Set();
        const uniqueClasses = raw.filter(c => {
            const key = `${c.absent_teacher}|${c.start_time}|${c.section_name}|${c.subject}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        // Group consecutive labs
        const grouped = [];
        uniqueClasses.forEach(c => {
            const isLab = c.subject_type?.toLowerCase() === 'lab';
            if (isLab && grouped.length > 0) {
                const prev = grouped[grouped.length - 1];
                if (prev.absent_teacher === c.absent_teacher && 
                    prev.subject === c.subject && 
                    prev.program_name === c.program_name &&
                    prev.semester === c.semester &&
                    prev.subject_type?.toLowerCase() === 'lab') {
                    
                    // Merge time by extending the end time
                    prev.end_time = c.end_time;
                    // Keep the substitute teacher if assigned in any of the slots
                    if (!prev.substitute_teacher && c.substitute_teacher) {
                        prev.substitute_teacher = c.substitute_teacher;
                    }
                    return;
                }
            }
            grouped.push({ ...c });
        });
        
        return grouped;
    })();
    
    // Group by absent teacher
    const absentTeacherGroups = {};
    filteredAbsentClasses.forEach(c => {
        if (!absentTeacherGroups[c.absent_teacher]) {
            absentTeacherGroups[c.absent_teacher] = [];
        }
        absentTeacherGroups[c.absent_teacher].push(c);
    });

    // Filter engaged substitutes by Today/Tomorrow
    const tomorrowDayName = new Date(Date.now() + 86400000).toLocaleDateString('en-US', { weekday: 'long' });
    const filteredEngagedSubstitutes = (stats?.engagedSubstitutes || []).filter(e => {
        return leavesDateFilter === 'Today' ? e.day === todayDayName : e.day === tomorrowDayName;
    });
    // Group by substitute teacher name
    const engagedSubstituteGroups = {};
    filteredEngagedSubstitutes.forEach(e => {
        if (!engagedSubstituteGroups[e.substitute_teacher]) {
            engagedSubstituteGroups[e.substitute_teacher] = [];
        }
        engagedSubstituteGroups[e.substitute_teacher].push(e);
    });

    return (
        <div>
            {/* Header */}
            <div style={{
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                flexWrap: 'wrap', gap: '12px', marginBottom: '24px'
            }}>
                <div>
                    <h1 style={{ fontFamily: 'Outfit, sans-serif', fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                        Dashboard Overview
                    </h1>
                    <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '4px 0 0' }}>
                        {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                </div>
                {stats?.activeSession && (
                    <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: '7px',
                        background: 'rgba(34,197,94,0.08)',
                        border: '1px solid rgba(34,197,94,0.2)',
                        borderRadius: '8px', padding: '6px 12px',
                        fontSize: '12.5px', fontWeight: 600, color: '#15803d'
                    }}>
                        <span style={{ width: '7px', height: '7px', background: '#22c55e', borderRadius: '50%' }}/>
                        {stats.activeSession.name}
                    </div>
                )}
            </div>

            {/* Stat Cards Grid — 2 per row on mobile, 4 on md, 4 on lg */}
            {loading ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '24px' }}
                    className="stats-grid">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} style={{
                            background: 'var(--app-surface)', border: '1px solid var(--app-border)',
                            borderRadius: '16px', padding: '20px'
                        }}>
                            <div className="skeleton" style={{ width: '44px', height: '44px', borderRadius: '12px', marginBottom: '16px' }}/>
                            <div className="skeleton" style={{ height: '10px', width: '60%', marginBottom: '10px' }}/>
                            <div className="skeleton" style={{ height: '28px', width: '40%' }}/>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="stats-grid" style={{ marginBottom: '24px' }}>
                    {STAT_CARDS.filter(c => !(isDeptAdmin && c.key === 'departments')).map(config => (
                    <div key={config.key}>
                        <StatCard config={config} value={s[config.key]} />
                    </div>
                ))}</div>
            )}

            {/* Bottom Row */}
            <div className="dashboard-bottom-grid">
                {/* Leaves & Substitutions */}
                <div style={{
                    background: 'var(--app-surface)',
                    border: '1px solid var(--app-border)',
                    borderRadius: '16px',
                    boxShadow: 'var(--shadow-sm)',
                    overflow: 'hidden',
                    minWidth: 0
                }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '16px 20px', borderBottom: '1px solid var(--app-border-2)'
                    }}>
                        <div>
                            <div style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>
                                Leaves & Substitutions (Today & Tomorrow)
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                Monitor absent teachers and engaged substitutes
                            </div>
                        </div>
                        <Link to={isDeptAdmin ? "/department/replacements" : "/admin/replacements"} className="btn btn-secondary btn-sm" style={{ fontSize: '12px' }}>
                            <i className="bi bi-arrow-up-right"/> Manage
                        </Link>
                    </div>
                    
                    <div style={{ padding: '20px' }}>
                        {loading ? (
                            <div style={{ textAlign: 'center' }}>
                                <div className="skeleton" style={{ height: '14px', marginBottom: '10px' }}/>
                                <div className="skeleton" style={{ height: '14px', marginBottom: '10px' }}/>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                <div>
                                    <h6 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--danger)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                        <i className="bi bi-person-dash" style={{ marginRight: '6px' }}/> Teachers on Leave (Overall)
                                    </h6>
                                    {stats?.leavesOverview?.length > 0 ? (
                                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                            {stats.leavesOverview.map(l => (
                                                <div key={l.id} style={{ background: 'var(--danger-light)', color: 'var(--danger-dark)', padding: '6px 12px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                                                    {l.teacher}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div style={{ fontSize: '13px', color: 'var(--text-muted)', background: 'var(--app-surface-2)', padding: '12px', borderRadius: '8px', border: '1px solid var(--app-border)' }}>
                                            No approved leaves.
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                        <h6 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                            <i className="bi bi-calendar3" style={{ marginRight: '6px' }}/> Substitution Schedule
                                        </h6>
                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                            {!isDeptAdmin && stats?.departmentsList && (
                                                <select 
                                                    className="form-select form-select-sm" 
                                                    style={{ width: 'auto', maxWidth: '150px', fontSize: '11px', padding: '2px 24px 2px 8px', minHeight: 'unset', height: '24px' }}
                                                    value={leavesDepartmentFilter}
                                                    onChange={e => setLeavesDepartmentFilter(e.target.value)}
                                                >
                                                    <option value="">All Departments</option>
                                                    {stats.departmentsList.map(d => (
                                                        <option key={d.id} value={d.id}>{d.short_code || d.name}</option>
                                                    ))}
                                                </select>
                                            )}
                                            <div className="btn-group">
                                                <button 
                                                    className={`btn btn-sm ${leavesDateFilter === 'Today' ? 'btn-primary' : 'btn-outline-secondary'}`}
                                                    onClick={() => setLeavesDateFilter('Today')}
                                                    style={{ fontSize: '11px', padding: '2px 8px' }}
                                                >Today</button>
                                                <button 
                                                    className={`btn btn-sm ${leavesDateFilter === 'Tomorrow' ? 'btn-primary' : 'btn-outline-secondary'}`}
                                                    onClick={() => setLeavesDateFilter('Tomorrow')}
                                                    style={{ fontSize: '11px', padding: '2px 8px' }}
                                                >Tomorrow</button>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {filteredAbsentClasses.length > 0 ? (
                                        <div className="table-responsive" style={{ maxHeight: '450px', overflow: 'auto', border: '1px solid var(--app-border-2)', borderRadius: '12px', background: 'var(--app-surface)' }}>
                                            <table className="table table-sm table-hover mb-0" style={{ fontSize: '12px' }}>
                                                <thead style={{ background: 'var(--app-surface-2)', position: 'sticky', top: 0, zIndex: 1 }}>
                                                    <tr>
                                                        <th style={{ padding: '8px 16px', minWidth: '95px', borderBottom: '1px solid var(--app-border-2)' }}>Time</th>
                                                        <th style={{ minWidth: '130px', borderBottom: '1px solid var(--app-border-2)' }}>Class</th>
                                                        <th style={{ minWidth: '100px', borderBottom: '1px solid var(--app-border-2)' }}>Subject</th>
                                                        <th style={{ minWidth: '120px', borderBottom: '1px solid var(--app-border-2)' }}>Covering For</th>
                                                        <th style={{ width: '150px', minWidth: '150px', borderBottom: '1px solid var(--app-border-2)' }}>Engaged (Substitute)</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {filteredAbsentClasses.map((c, idx) => {
                                                        // Find status if assigned
                                                        const match = (stats?.engagedSubstitutes || []).find(e => e.absent_teacher === c.absent_teacher && e.start_time === c.start_time && e.section_name === c.section_name);
                                                        const status = match ? match.status : null;
                                                        return (
                                                            <tr key={idx} style={{ background: c.subject_type?.toLowerCase() === 'lab' ? 'rgba(99, 102, 241, 0.06)' : 'transparent' }}>
                                                                <td style={{ padding: '8px 16px', fontWeight: 500 }}>
                                                                    <div style={{ whiteSpace: 'nowrap' }}>{c.start_time?.substring(0, 5)}</div>
                                                                    {c.end_time && (
                                                                        <div style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>
                                                                            to {c.end_time.substring(0, 5)}
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                <td>
                                                                    <div style={{ fontSize: '13px', fontWeight: 500 }}>
                                                                        {c.semester ? `${c.semester} ` : ''}{c.program_name} {c.section_count > 1 ? `B${c.section_index}` : ''}
                                                                    </div>
                                                                </td>
                                                                <td>
                                                                    {c.subject}
                                                                    {c.subject_type?.toLowerCase() === 'lab' && (
                                                                        <span className="badge ms-2" style={{ background: 'rgba(79, 70, 229, 0.1)', color: '#4f46e5', fontSize: '10px', border: '1px solid rgba(79, 70, 229, 0.2)' }}>Lab</span>
                                                                    )}
                                                                </td>
                                                                <td style={{ color: 'var(--text-muted)' }}>{c.absent_teacher}</td>
                                                                <td>
                                                                    {c.substitute_teacher ? (
                                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px' }}>
                                                                            <span style={{ background: 'var(--success-light)', color: 'var(--success-dark)', padding: '2px 6px', borderRadius: '4px', fontWeight: 600, fontSize: '11px', border: '1px solid rgba(16, 185, 129, 0.2)', display: 'inline-block' }}>
                                                                                {c.substitute_teacher}
                                                                            </span>
                                                                            {status && (
                                                                                <span style={{ fontSize: '9px', textTransform: 'uppercase', color: status === 'approved' ? '#10b981' : '#f59e0b', fontWeight: 600 }}>
                                                                                    {status}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    ) : (
                                                                        <span style={{ background: 'var(--warning-light)', color: 'var(--warning-dark)', padding: '2px 6px', borderRadius: '4px', fontWeight: 500, fontSize: '11px', border: '1px solid rgba(245, 158, 11, 0.2)', display: 'inline-block' }}>
                                                                            Not Assigned
                                                                        </span>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <div style={{ fontSize: '13px', color: 'var(--text-muted)', background: 'var(--app-surface-2)', padding: '12px', borderRadius: '8px', border: '1px solid var(--app-border)', textAlign: 'center' }}>
                                            No substitution data available for {leavesDateFilter.toLowerCase()}.
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Recent Activity */}
                <div style={{
                    background: 'var(--app-surface)',
                    border: '1px solid var(--app-border)',
                    borderRadius: '16px',
                    boxShadow: 'var(--shadow-sm)',
                    overflow: 'hidden',
                    display: 'flex', flexDirection: 'column',
                    minWidth: 0
                }}>
                    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--app-border-2)', flexShrink: 0 }}>
                        <div style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>Recent Activity</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>Latest system changes</div>
                    </div>
                    <div className="scroll-area" style={{ flex: 1, maxHeight: '360px', overflowY: 'auto', padding: '4px 0' }}>
                        {loading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} style={{ padding: '12px 16px', borderBottom: '1px solid var(--app-border-2)', display: 'flex', gap: '10px' }}>
                                    <div className="skeleton" style={{ width: '30px', height: '30px', borderRadius: '8px', flexShrink: 0 }}/>
                                    <div style={{ flex: 1 }}>
                                        <div className="skeleton" style={{ height: '12px', width: '70%', marginBottom: '6px' }}/>
                                        <div className="skeleton" style={{ height: '10px', width: '50%' }}/>
                                    </div>
                                </div>
                            ))
                        ) : stats?.recentActivities?.length > 0 ? stats.recentActivities.map((log, i) => (
                            <div key={i} style={{
                                display: 'flex', alignItems: 'flex-start', gap: '10px',
                                padding: '10px 16px', borderBottom: '1px solid var(--app-border-2)',
                            }}>
                                <div style={{
                                    width: '30px', height: '30px', flexShrink: 0,
                                    borderRadius: '8px', background: 'var(--primary-50)',
                                    border: '1px solid var(--primary-100)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: 'var(--accent)', fontSize: '13px'
                                }}>
                                    <i className="bi bi-activity"/>
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                                        {log.action?.replace(/_/g, ' ')}
                                    </div>
                                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                        by {log.username || 'System'} · {new Date(log.created_at).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
                                    </div>
                                </div>
                            </div>
                        )) : (
                            <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-muted)', fontSize: '13px' }}>
                                No recent activity.
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <style>{`
                /* 2 per row on mobile, 4 per row on larger screens */
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 12px;
                }
                @media (min-width: 576px) {
                    .stats-grid { grid-template-columns: repeat(2, 1fr); gap: 14px; }
                }
                @media (min-width: 768px) {
                    .stats-grid { grid-template-columns: repeat(4, 1fr); gap: 14px; }
                }
                @media (min-width: 1200px) {
                    .stats-grid { grid-template-columns: repeat(4, 1fr); gap: 16px; }
                }
                .dashboard-bottom-grid {
                    display: grid;
                    grid-template-columns: 1fr;
                    gap: 16px;
                }
                @media (min-width: 900px) {
                    .dashboard-bottom-grid { grid-template-columns: 1fr 340px; }
                }
            `}</style>
        </div>
    );
};

export default Dashboard;
