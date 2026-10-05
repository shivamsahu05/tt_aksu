import React, { useState, useEffect, useCallback } from 'react';
import api from '../../utils/api';

const REASON_CONFIG = {
    TEACHER_BUSY: { icon: 'bi-person-x-fill', color: 'var(--danger)', bg: 'var(--danger-light)', border: 'var(--danger-dark)', label: 'Teacher Busy' },
    ROOM_OCCUPIED: { icon: 'bi-door-closed-fill', color: 'var(--warning)', bg: 'var(--warning-light)', border: 'var(--warning-dark)', label: 'Room Occupied' },
    NO_ALLOCATION: { icon: 'bi-clipboard-x-fill', color: 'var(--text-secondary)', bg: 'var(--app-surface-2)', border: 'var(--app-border)', label: 'No Allocation' },
    SCHEDULER_SKIPPED: { icon: 'bi-skip-forward-fill', color: 'var(--info)', bg: 'var(--info-light)', border: 'var(--info-dark)', label: 'Scheduler Skipped' },
};

const TAG_STYLE = (type) => {
    const cfg = REASON_CONFIG[type] || REASON_CONFIG.SCHEDULER_SKIPPED;
    return { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: '999px', background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color, whiteSpace: 'nowrap' };
};

export default function GapAnalysisModal({ show, onClose, sessionId, departmentId, departmentName }) {
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState(null);
    const [summary, setSummary] = useState(null);
    const [expandedSection, setExpandedSection] = useState(null);
    const [filterType, setFilterType] = useState('ALL');

    const fetchAnalysis = useCallback(async () => {
        if (!sessionId) return;
        setLoading(true); setData(null); setSummary(null); setExpandedSection(null);
        try {
            const params = new URLSearchParams({ session_id: sessionId });
            if (departmentId) params.append('department_id', departmentId);
            const res = await api.get(`/timetable/gap-analysis?${params}`);
            if (res.data.success) {
                setData(res.data.data);
                setSummary(res.data.summary);
                if (res.data.data.length > 0) setExpandedSection(res.data.data[0].sectionId);
            }
        } catch (e) { console.error('Gap analysis failed', e); }
        finally { setLoading(false); }
    }, [sessionId, departmentId]);

    useEffect(() => { if (show) fetchAnalysis(); }, [show, fetchAnalysis]);

    if (!show) return null;

    const typeCounts = { TEACHER_BUSY: 0, ROOM_OCCUPIED: 0, NO_ALLOCATION: 0, SCHEDULER_SKIPPED: 0 };
    if (data) { for (const sec of data) { for (const g of sec.gaps) { if (typeCounts[g.reasonType] !== undefined) typeCounts[g.reasonType]++; else typeCounts.SCHEDULER_SKIPPED++; } } }

    const filteredData = data ? data.map(sec => ({ ...sec, gaps: filterType === 'ALL' ? sec.gaps : sec.gaps.filter(g => g.reasonType === filterType) })).filter(sec => sec.gaps.length > 0) : [];

    return (
        <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 1060, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
            <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 1061, width: 'min(92vw,860px)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', background: 'var(--app-surface,#fff)', borderRadius: '16px', boxShadow: '0 25px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ padding: '20px 24px', background: 'linear-gradient(135deg,#1e1b4b 0%,#312e81 60%,#4c1d95 100%)', color: '#fff', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <i className="bi bi-graph-up-arrow" style={{ fontSize: '1.4rem' }} />
                                <h5 style={{ margin: 0, fontWeight: 700, fontSize: '1.1rem' }}>Gap Analysis Report</h5>
                            </div>
                            {departmentName && <div style={{ fontSize: '0.8rem', opacity: 0.75, marginTop: '4px' }}>📁 {departmentName}</div>}
                        </div>
                        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: '8px', width: '34px', height: '34px', cursor: 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><i className="bi bi-x-lg" /></button>
                    </div>
                    {summary && !loading && (
                        <div style={{ marginTop: '14px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            {[{ label: 'Total Gaps', value: summary.totalGaps, icon: 'bi-exclamation-triangle-fill', color: '#fbbf24' }, { label: 'Sections', value: `${summary.sectionsWithGaps}/${summary.totalSections}`, icon: 'bi-people-fill', color: '#60a5fa' }, { label: 'Teacher Busy', value: typeCounts.TEACHER_BUSY, icon: 'bi-person-x-fill', color: '#f87171' }, { label: 'Room Occupied', value: typeCounts.ROOM_OCCUPIED, icon: 'bi-door-closed-fill', color: '#fb923c' }, { label: 'Sched. Skip', value: typeCounts.SCHEDULER_SKIPPED, icon: 'bi-skip-forward-fill', color: '#a78bfa' }].map(stat => (
                                <div key={stat.label} style={{ background: 'rgba(255,255,255,0.12)', borderRadius: '10px', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <i className={`bi ${stat.icon}`} style={{ color: stat.color, fontSize: '0.9rem' }} />
                                    <span style={{ fontSize: '0.95rem', fontWeight: 700 }}>{stat.value}</span>
                                    <span style={{ fontSize: '0.72rem', opacity: 0.7 }}>{stat.label}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Filter Bar */}
                {data && data.length > 0 && (
                    <div style={{ padding: '10px 24px', borderBottom: '1px solid var(--app-border,#e5e7eb)', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', background: 'var(--app-surface-2,#f8fafc)', flexShrink: 0 }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--app-muted)', marginRight: '2px' }}>Filter:</span>
                        {['ALL', 'TEACHER_BUSY', 'ROOM_OCCUPIED', 'SCHEDULER_SKIPPED', 'NO_ALLOCATION'].map(type => {
                            const cfg = type === 'ALL' ? null : REASON_CONFIG[type];
                            const count = type === 'ALL' ? summary?.totalGaps : typeCounts[type];
                            if (type !== 'ALL' && count === 0) return null;
                            return (
                                <button key={type} onClick={() => setFilterType(type)} style={{ padding: '3px 12px', borderRadius: '999px', border: filterType === type ? `2px solid ${cfg?.color || 'var(--accent)'}` : '1.5px solid var(--app-border,#e5e7eb)', background: filterType === type ? (cfg?.bg || 'var(--info-light)') : 'transparent', color: filterType === type ? (cfg?.color || 'var(--accent-hover)') : 'var(--app-muted)', fontSize: '0.73rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    {cfg && <i className={`bi ${cfg.icon}`} />}
                                    {type === 'ALL' ? 'All' : cfg?.label} ({count})
                                </button>
                            );
                        })}
                        <button onClick={fetchAnalysis} style={{ marginLeft: 'auto', padding: '4px 12px', borderRadius: '8px', border: '1.5px solid var(--accent)', background: 'var(--info-light)', color: 'var(--accent-hover)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <i className="bi bi-arrow-clockwise" /> Refresh
                        </button>
                    </div>
                )}

                {/* Body */}
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {loading && (
                        <div style={{ padding: '60px 24px', textAlign: 'center', color: 'var(--app-muted)' }}>
                            <div className="spinner-border text-primary mb-3" role="status" style={{ width: '2.5rem', height: '2.5rem' }} />
                            <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>Analysing gaps across all sections...</div>
                            <div style={{ fontSize: '0.78rem', marginTop: '6px', opacity: 0.7 }}>Checking teacher conflicts, room availability, allocation status...</div>
                        </div>
                    )}
                    {!loading && data && data.length === 0 && (
                        <div style={{ padding: '60px 24px', textAlign: 'center' }}>
                            <i className="bi bi-check-circle-fill" style={{ fontSize: '3rem', color: '#22c55e' }} />
                            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#15803d', marginTop: '12px' }}>No Internal Gaps Found!</div>
                            <div style={{ fontSize: '0.83rem', color: 'var(--app-muted)', marginTop: '6px' }}>All sections have compact, gap-free schedules.</div>
                        </div>
                    )}
                    {!loading && filteredData.length === 0 && data && data.length > 0 && (
                        <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--app-muted)' }}>
                            <i className="bi bi-funnel" style={{ fontSize: '2rem' }} />
                            <div style={{ marginTop: '10px', fontSize: '0.88rem' }}>No gaps of this type found.</div>
                        </div>
                    )}
                    {!loading && filteredData.map((sec) => {
                        const isExpanded = expandedSection === sec.sectionId;
                        return (
                            <div key={sec.sectionId} style={{ borderBottom: '1px solid var(--app-border,#e5e7eb)' }}>
                                <div onClick={() => setExpandedSection(isExpanded ? null : sec.sectionId)} style={{ padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', background: isExpanded ? 'var(--app-surface-2,#f8fafc)' : 'var(--app-surface,#fff)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: sec.gapCount >= 3 ? 'var(--danger-light)' : sec.gapCount >= 2 ? 'var(--warning-light)' : 'var(--success-light)', color: sec.gapCount >= 3 ? 'var(--danger)' : sec.gapCount >= 2 ? 'var(--warning)' : 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.95rem', flexShrink: 0 }}>{sec.gapCount}</div>
                                        <div>
                                            <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{sec.className} {sec.sectionName && sec.sectionName !== sec.className && <span style={{ color: 'var(--accent)' }}>({sec.sectionName})</span>}</div>
                                            <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{sec.deptName} · {sec.gapCount} gap{sec.gapCount !== 1 ? 's' : ''}</div>
                                        </div>
                                    </div>
                                    <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'}`} style={{ color: 'var(--app-muted)' }} />
                                </div>
                                {isExpanded && (
                                    <div style={{ padding: '0 24px 14px' }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: '80px 120px 1fr', gap: '0', fontSize: '0.7rem', fontWeight: 700, color: 'var(--app-muted)', padding: '6px 12px', borderBottom: '1px solid var(--app-border,#e5e7eb)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                            <span>Day</span><span>Slot</span><span>Reason</span>
                                        </div>
                                        {sec.gaps.map((gap, gi) => {
                                            const cfg = REASON_CONFIG[gap.reasonType] || REASON_CONFIG.SCHEDULER_SKIPPED;
                                            return (
                                                <div key={gi} style={{ display: 'grid', gridTemplateColumns: '80px 120px 1fr', gap: '0', padding: '8px 12px', borderBottom: gi < sec.gaps.length - 1 ? '1px dashed var(--app-border,#e5e7eb)' : 'none', alignItems: 'start', background: gi % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.018)' }}>
                                                    <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{gap.day}</span>
                                                    <div>
                                                        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent)' }}>{gap.slot}</div>
                                                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{gap.slotTime}</div>
                                                    </div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                                        <span style={TAG_STYLE(gap.reasonType)}><i className={`bi ${cfg.icon}`} />{cfg.label}</span>
                                                        <span style={{ fontSize: '0.7rem', color: 'var(--app-muted)', lineHeight: 1.4 }}>{gap.reason}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Footer */}
                <div style={{ padding: '10px 24px', borderTop: '1px solid var(--app-border,#e5e7eb)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--app-surface-2,#f8fafc)', flexShrink: 0, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    <span><i className="bi bi-info-circle me-1" />Only <strong>internal gaps</strong> (slots between classes) are shown. Leading/trailing free periods are normal.</span>
                    <button onClick={onClose} style={{ padding: '5px 16px', borderRadius: '8px', border: '1.5px solid var(--app-border)', background: 'transparent', color: 'var(--app-text)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>Close</button>
                </div>
            </div>
        </>
    );
}
