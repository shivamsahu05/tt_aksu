import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import PageHeader from '../../components/common/PageHeader';
import { toast } from 'react-toastify';

const SettingsSection = ({ title, description, children, icon, accentColor }) => (
    <div style={{
        background: 'var(--app-surface)',
        border: '1px solid var(--app-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        marginBottom: '16px',
        overflow: 'hidden'
    }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--app-border-2)', display: 'flex', alignItems: 'center', gap: '10px' }}>
            {icon && (
                <div style={{
                    width: '32px', height: '32px', borderRadius: '8px',
                    background: accentColor ? `${accentColor}18` : 'var(--primary-light)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: accentColor || 'var(--primary)', fontSize: '15px', flexShrink: 0
                }}>
                    <i className={`bi bi-${icon}`} />
                </div>
            )}
            <div>
                <div style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>{title}</div>
                {description && <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '2px' }}>{description}</div>}
            </div>
        </div>
        <div style={{ padding: '20px' }}>
            {children}
        </div>
    </div>
);

const InfoBanner = ({ children, type = 'warning' }) => {
    const colors = {
        warning: { bg: 'var(--warning-light)', border: 'rgba(245,158,11,0.25)', text: 'var(--warning-dark)', icon: 'info-circle-fill' },
        success: { bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.25)', text: '#16a34a', icon: 'check-circle-fill' },
        danger:  { bg: 'rgba(239,68,68,0.07)', border: 'rgba(239,68,68,0.25)', text: '#dc2626', icon: 'exclamation-triangle-fill' },
        info:    { bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.25)', text: '#4f46e5', icon: 'info-circle-fill' },
    };
    const c = colors[type];
    return (
        <div style={{ display: 'flex', gap: '8px', padding: '10px 12px', marginTop: '8px', background: c.bg, border: `1px solid ${c.border}`, borderRadius: 'var(--radius-sm)', fontSize: '12.5px', color: c.text }}>
            <i className={`bi bi-${c.icon}`} style={{ marginTop: '1px', flexShrink: 0 }} />
            <div>{children}</div>
        </div>
    );
};

const Settings = () => {
    const [settings, setSettings] = useState({
        college_name: '',
        academic_year: '',
        default_theme: 'light',
        email_notifications: 'enabled',
        sms_notifications: 'enabled',
        whatsapp_notifications: 'enabled'
    });
    const [smtpInfo, setSmtpInfo] = useState({ configured: false, host: '', user: '', port: '587' });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState(null);

    // SMTP test state
    const [testEmail, setTestEmail] = useState('');
    const [smtpTesting, setSmtpTesting] = useState(false);

    // Session reset state
    const [sessions, setSessions] = useState([]);
    const [selectedSession, setSelectedSession] = useState('');
    const [resetting, setResetting] = useState(false);

    useEffect(() => {
        const fetchAll = async () => {
            try {
                const [settingsRes, sessionsRes] = await Promise.all([
                    api.get('/settings'),
                    api.get('/sessions?limit=50')
                ]);
                if (settingsRes.data.success && Object.keys(settingsRes.data.data).length > 0) {
                    const d = settingsRes.data.data;
                    setSettings(prev => ({ ...prev, ...d }));
                    setSmtpInfo({
                        configured: !!d._smtp_configured,
                        host: d._smtp_host || '',
                        user: d._smtp_user || '',
                        port: d._smtp_port || '587'
                    });
                }
                if (sessionsRes.data.success) {
                    setSessions(sessionsRes.data.data || []);
                }
            } catch (error) {
                toast.error('Failed to load settings');
            } finally {
                setLoading(false);
            }
        };
        fetchAll();
    }, []);

    const handleChange = (e) => {
        setSettings({ ...settings, [e.target.name]: e.target.value });
    };

    // ── Save Settings with 2-step SweetAlert confirmation ──────────────
    const handleSave = async (e) => {
        e.preventDefault();
        const Swal = (await import('sweetalert2')).default;

        // Step 1 – are you sure?
        const step1 = await Swal.fire({
            title: 'Save Settings?',
            text: 'You are about to update system-wide settings. Please confirm.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#4f46e5',
            cancelButtonColor: '#6b7280',
            confirmButtonText: 'Yes, proceed',
            cancelButtonText: 'Cancel'
        });
        if (!step1.isConfirmed) return;

        // Step 2 – final confirmation
        const step2 = await Swal.fire({
            title: 'Final Confirmation',
            html: `<p style="color:#374151;font-size:14px;">This will update settings for all users of the system. Are you <strong>absolutely sure</strong>?</p>`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#6b7280',
            confirmButtonText: '✔ Confirm & Save',
            cancelButtonText: 'Cancel'
        });
        if (!step2.isConfirmed) return;

        setSaving(true);
        try {
            await api.put('/settings', settings);
            toast.success('Settings saved successfully!');
            sessionStorage.removeItem('ttms-theme-override');
            if (settings.default_theme) {
                localStorage.setItem('ttms-default-theme', settings.default_theme);
                window.dispatchEvent(new CustomEvent('default-theme-changed', { detail: settings.default_theme }));
            }
        } catch (error) {
            toast.error('Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    // ── SMTP Test with 2-step confirmation ─────────────────────────────
    const handleSmtpTest = async () => {
        if (!testEmail || !testEmail.includes('@')) {
            toast.error('Please enter a valid email address for the test');
            return;
        }

        const Swal = (await import('sweetalert2')).default;

        // Step 1
        const step1 = await Swal.fire({
            title: 'Send Test Email?',
            html: `<p style="color:#374151;font-size:14px;">A test email will be sent to <strong>${testEmail}</strong> using your SMTP configuration.</p>`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#4f46e5',
            cancelButtonColor: '#6b7280',
            confirmButtonText: 'Yes, send it',
        });
        if (!step1.isConfirmed) return;

        // Step 2
        const step2 = await Swal.fire({
            title: 'Confirm SMTP Test',
            html: `<p style="color:#374151;font-size:14px;">Sending to: <strong>${testEmail}</strong><br/>Host: <strong>${smtpInfo.host || 'Not configured'}</strong></p>`,
            icon: 'info',
            showCancelButton: true,
            confirmButtonColor: '#059669',
            cancelButtonColor: '#6b7280',
            confirmButtonText: '✔ Send Test Email',
        });
        if (!step2.isConfirmed) return;

        setSmtpTesting(true);
        try {
            const res = await api.post('/settings/test-smtp', { to_email: testEmail });
            if (res.data.success) {
                Swal.fire('Email Sent!', res.data.message, 'success');
            }
        } catch (error) {
            Swal.fire('SMTP Failed', error.response?.data?.message || 'Failed to send test email. Check .env SMTP settings.', 'error');
        } finally {
            setSmtpTesting(false);
        }
    };

    // ── Session Reset with 2-step confirmation ──────────────────────────
    const handleSessionReset = async () => {
        if (!selectedSession) {
            toast.error('Please select a session to reset');
            return;
        }

        const sessionObj = sessions.find(s => String(s.id) === String(selectedSession));
        const sessionName = sessionObj?.name || `Session #${selectedSession}`;

        const Swal = (await import('sweetalert2')).default;

        // Step 1 – explain what will happen
        const step1 = await Swal.fire({
            title: '⚠️ Reset Session Assignments?',
            html: `
                <p style="color:#374151;font-size:14px;text-align:left;">This will <strong>permanently clear</strong> the following for <strong>"${sessionName}"</strong>:</p>
                <ul style="color:#6b7280;font-size:13px;text-align:left;padding-left:20px;margin-top:8px;">
                    <li>All <strong>Classroom (Home Room)</strong> assignments from sections</li>
                    <li>All <strong>Teacher–Subject</strong> allocations</li>
                </ul>
                <p style="color:#374151;font-size:13px;margin-top:12px;text-align:left;">The timetable entries and class/section structure are <strong>not deleted</strong>. You will need to re-assign rooms and teachers for the new session.</p>
            `,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#f59e0b',
            cancelButtonColor: '#6b7280',
            confirmButtonText: 'Yes, I understand – Proceed',
            cancelButtonText: 'Cancel'
        });
        if (!step1.isConfirmed) return;

        // Step 2 – final type-to-confirm
        const step2 = await Swal.fire({
            title: '🔴 Final Confirmation',
            html: `
                <p style="color:#dc2626;font-size:14px;font-weight:600;margin-bottom:12px;">This action cannot be undone!</p>
                <p style="color:#374151;font-size:13px;">Type <strong>RESET</strong> below to confirm clearing all assignments for <strong>"${sessionName}"</strong>:</p>
            `,
            input: 'text',
            inputPlaceholder: 'Type RESET here',
            inputAttributes: { autocomplete: 'off', style: 'text-transform:uppercase;letter-spacing:2px;text-align:center;font-weight:700;' },
            icon: 'error',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#6b7280',
            confirmButtonText: 'Confirm Reset',
            preConfirm: (value) => {
                if (value.trim().toUpperCase() !== 'RESET') {
                    Swal.showValidationMessage('Please type RESET to confirm');
                    return false;
                }
                return true;
            }
        });
        if (!step2.isConfirmed) return;

        setResetting(true);
        try {
            const res = await api.post('/settings/reset-session-assignments', { session_id: parseInt(selectedSession) });
            if (res.data.success) {
                const d = res.data.details;
                Swal.fire({
                    title: '✅ Reset Complete',
                    html: `
                        <p style="font-size:14px;color:#374151;">${res.data.message}</p>
                        <hr style="border-color:#e5e7eb;margin:12px 0;"/>
                        <div style="text-align:left;font-size:13px;color:#6b7280;">
                            <div>📋 Sections processed: <strong>${d.sections_processed}</strong></div>
                            <div>🏫 Classrooms cleared: <strong>${d.home_rooms_cleared}</strong></div>
                            <div>👨‍🏫 Allocations removed: <strong>${d.allocations_deleted}</strong></div>
                        </div>
                    `,
                    icon: 'success'
                });
                setSelectedSession('');
            }
        } catch (error) {
            Swal.fire('Reset Failed', error.response?.data?.message || 'Something went wrong during reset.', 'error');
        } finally {
            setResetting(false);
        }
    };

    if (loading) {
        return (
            <div>
                <div style={{ marginBottom: '24px' }}>
                    <div className="skeleton" style={{ height: '28px', width: '200px', marginBottom: '8px' }}/>
                    <div className="skeleton" style={{ height: '16px', width: '280px' }}/>
                </div>
                {[1, 2, 3].map(i => (
                    <div key={i} style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)', borderRadius: 'var(--radius-lg)', marginBottom: '16px', overflow: 'hidden' }}>
                        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--app-border-2)' }}>
                            <div className="skeleton" style={{ height: '16px', width: '160px' }}/>
                        </div>
                        <div style={{ padding: '20px' }}>
                            <div className="skeleton" style={{ height: '40px', marginBottom: '12px' }}/>
                            <div className="skeleton" style={{ height: '40px' }}/>
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div>
            <PageHeader
                title="System Settings"
                subtitle="Configure application-wide parameters and preferences"
                icon="bi-gear-fill"
            />

            <div style={{ maxWidth: '720px' }}>

                {/* ── Institution Information ── */}
                <SettingsSection
                    title="Institution Information"
                    description="Basic details about your institution shown in reports and exports"
                    icon="building"
                    accentColor="#4f46e5"
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div>
                            <label className="form-label">College / Institute Name</label>
                            <input type="text" className="form-control" name="college_name" value={settings.college_name} onChange={handleChange} placeholder="e.g., Government Engineering College" />
                            <div className="form-text">Displayed in timetable reports and PDF exports.</div>
                        </div>
                        <div>
                            <label className="form-label">Current Academic Year</label>
                            <input type="text" className="form-control" name="academic_year" value={settings.academic_year} onChange={handleChange} placeholder="e.g., 2026-2027" />
                        </div>
                    </div>
                </SettingsSection>

                {/* ── System Preferences ── */}
                <SettingsSection
                    title="System Preferences"
                    description="Control application behavior and display settings"
                    icon="sliders"
                    accentColor="#0891b2"
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div>
                            <label className="form-label">Default UI Theme</label>
                            <select className="form-select" name="default_theme" value={settings.default_theme} onChange={handleChange}>
                                <option value="light">Light Mode</option>
                                <option value="dark">Dark Mode</option>
                                <option value="system">Follow System Setting</option>
                            </select>
                            <div className="form-text">The theme toggle in the top navbar overrides this preference per-session.</div>
                        </div>
                    </div>
                </SettingsSection>

                {/* ── Notification Preferences ── */}
                <SettingsSection
                    title="Notification Preferences"
                    description="Enable or disable notification channels across the system"
                    icon="bell-fill"
                    accentColor="#0ea5e9"
                >
                    <div className="row g-3">
                        <div className="col-12 col-md-4">
                            <label className="form-label d-flex align-items-center gap-2"><i className="bi bi-envelope text-primary"></i> Email Notifications</label>
                            <select className="form-select" name="email_notifications" value={settings.email_notifications} onChange={handleChange}>
                                <option value="enabled">Enabled</option>
                                <option value="disabled">Disabled</option>
                            </select>
                        </div>
                        <div className="col-12 col-md-4">
                            <label className="form-label d-flex align-items-center gap-2"><i className="bi bi-chat-text text-success"></i> SMS Notifications</label>
                            <select className="form-select" name="sms_notifications" value={settings.sms_notifications || 'enabled'} onChange={handleChange}>
                                <option value="enabled">Enabled</option>
                                <option value="disabled">Disabled</option>
                            </select>
                        </div>
                        <div className="col-12 col-md-4">
                            <label className="form-label d-flex align-items-center gap-2"><i className="bi bi-whatsapp text-success"></i> WhatsApp Notifications</label>
                            <select className="form-select" name="whatsapp_notifications" value={settings.whatsapp_notifications || 'enabled'} onChange={handleChange}>
                                <option value="enabled">Enabled</option>
                                <option value="disabled">Disabled</option>
                            </select>
                        </div>
                    </div>
                </SettingsSection>

                {/* ── Save Button ── */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginBottom: '16px' }}>
                    <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                        {saving ? (
                            <><span className="spinner-border spinner-border-sm me-2" role="status" />Saving...</>
                        ) : (
                            <><i className="bi bi-check-lg me-2" />Save Settings</>
                        )}
                    </button>
                </div>

                {/* ── Session Reset ── */}
                <SettingsSection
                    title="Next Session — Reset Assignments"
                    description="Clear classroom and teacher assignments to prepare for a new academic session"
                    icon="arrow-repeat"
                    accentColor="#dc2626"
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        {/* Explanation */}
                        <InfoBanner type="danger">
                            <strong>Destructive action.</strong> This will permanently remove all <strong>classroom (home room)</strong> assignments and <strong>teacher–subject allocations</strong> for the selected session's sections.
                            Use this when starting a new semester so you can re-assign rooms and teachers fresh. The timetable history and class structures are preserved.
                        </InfoBanner>

                        <div>
                            <label className="form-label">Select Session to Reset</label>
                            <select className="form-select" value={selectedSession} onChange={e => setSelectedSession(e.target.value)}>
                                <option value="">— Choose an academic session —</option>
                                {sessions.map(s => (
                                    <option key={s.id} value={s.id}>
                                        {s.name}{s.is_active ? ' (Active)' : ''}
                                    </option>
                                ))}
                            </select>
                            <div className="form-text">Select the session whose class-room and teacher assignments you want to clear.</div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                                type="button"
                                className="btn btn-danger"
                                onClick={handleSessionReset}
                                disabled={resetting || !selectedSession}
                                style={{ minWidth: '180px' }}
                            >
                                {resetting ? (
                                    <><span className="spinner-border spinner-border-sm me-2" role="status" />Resetting...</>
                                ) : (
                                    <><i className="bi bi-arrow-repeat me-2" />Reset Assignments</>
                                )}
                            </button>
                        </div>
                    </div>
                </SettingsSection>

                {/* ── System Maintenance ── */}
                <SettingsSection
                    title="System Maintenance"
                    description="Tools to keep your database clean and optimized"
                    icon="tools"
                    accentColor="#7c3aed"
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                            <div style={{ flex: 1 }}>
                                <h6 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Cleanup Duplicate Data</h6>
                                <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: 0 }}>
                                    Automatically identify and safely remove exact duplicate entries in teachers, classes, and timetable records.
                                </p>
                            </div>
                            <button
                                type="button"
                                className="btn btn-outline-primary"
                                disabled={isAnalyzing}
                                onClick={async () => {
                                    setIsAnalyzing(true);
                                    try {
                                        const res = await api.get('/settings/analyze-duplicates');
                                        if (res.data.success) {
                                            setAnalysisResult(res.data);
                                            if (res.data.total === 0) {
                                                const Swal = (await import('sweetalert2')).default;
                                                Swal.fire('No Duplicates', 'No duplicate records found in the system.', 'info');
                                            }
                                        }
                                    } catch (error) {
                                        toast.error('Failed to analyze duplicates');
                                    } finally {
                                        setIsAnalyzing(false);
                                    }
                                }}
                            >
                                {isAnalyzing ? (
                                    <><span className="spinner-border spinner-border-sm me-2" role="status" />Analyzing...</>
                                ) : (
                                    <><i className="bi bi-search" style={{ marginRight: '6px' }} />Analyze Duplicates</>
                                )}
                            </button>
                        </div>

                        {analysisResult && analysisResult.total > 0 && (
                            <div style={{ background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 'var(--radius-md)', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div>
                                    <h6 style={{ color: '#dc2626', fontWeight: 600, fontSize: '14px', marginBottom: '8px' }}>
                                        <i className="bi bi-exclamation-triangle-fill me-2" />
                                        {analysisResult.total} Duplicates Found
                                    </h6>
                                    <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                        {analysisResult.details.teachers > 0 && <li>{analysisResult.details.teachers} duplicate teachers</li>}
                                        {analysisResult.details.classes > 0 && <li>{analysisResult.details.classes} duplicate classes</li>}
                                        {analysisResult.details.timetable > 0 && <li>{analysisResult.details.timetable} duplicate timetable entries</li>}
                                    </ul>
                                </div>
                                <button
                                    type="button"
                                    className="btn btn-danger"
                                    onClick={async () => {
                                        const Swal = (await import('sweetalert2')).default;
                                        const result = await Swal.fire({
                                            title: 'Are you sure?',
                                            text: 'This action will permanently delete these duplicate records.',
                                            icon: 'warning',
                                            showCancelButton: true,
                                            confirmButtonColor: '#ef4444',
                                            cancelButtonColor: '#6b7280',
                                            confirmButtonText: 'Confirm & Clean'
                                        });

                                        if (result.isConfirmed) {
                                            try {
                                                const res = await api.delete('/settings/cleanup-duplicates');
                                                if (res.data.success) {
                                                    setAnalysisResult(null);
                                                    Swal.fire('Cleaned!', res.data.message, 'success');
                                                }
                                            } catch (error) {
                                                Swal.fire('Error', 'Failed to cleanup duplicate data', 'error');
                                            }
                                        }
                                    }}
                                >
                                    <i className="bi bi-trash" style={{ marginRight: '6px' }} />
                                    Confirm & Clean
                                </button>
                            </div>
                        )}
                    </div>
                </SettingsSection>

                {/* ── AI Suggestions & Analytics (Beta) ── */}
                <SettingsSection
                    title="AI Suggestions & Analytics (Beta)"
                    description="Smart insights for timetable optimization and resource management"
                    icon="magic"
                    accentColor="#f59e0b"
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <InfoBanner type="info">
                            <strong>Future Feature:</strong> These AI-powered analysis tools are currently in development. They will provide automated recommendations based on your historical data and current allocations.
                        </InfoBanner>

                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', padding: '12px', border: '1px dashed var(--app-border-2)', borderRadius: 'var(--radius-md)' }}>
                            <div style={{ fontSize: '24px', color: '#8b5cf6', marginTop: '-4px' }}><i className="bi bi-diagram-3-fill"></i></div>
                            <div style={{ flex: 1 }}>
                                <h6 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Class Merge Analysis</h6>
                                <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: 0, marginBottom: '10px' }}>
                                    Analyze student strength and subject commonality to suggest which classes/sections should be merged or split.
                                </p>
                                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => toast.info('Class Merge Analysis is coming soon!')}>
                                    <i className="bi bi-play-circle me-1"></i> Run Analysis
                                </button>
                            </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', padding: '12px', border: '1px dashed var(--app-border-2)', borderRadius: 'var(--radius-md)' }}>
                            <div style={{ fontSize: '24px', color: '#10b981', marginTop: '-4px' }}><i className="bi bi-calendar-check-fill"></i></div>
                            <div style={{ flex: 1 }}>
                                <h6 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Timetable Micro-Optimizations</h6>
                                <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: 0, marginBottom: '10px' }}>
                                    Scan existing timetables for minor adjustments to reduce faculty idle time or fix scattered student schedules.
                                </p>
                                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => toast.info('Timetable Optimization is coming soon!')}>
                                    <i className="bi bi-play-circle me-1"></i> Run Analysis
                                </button>
                            </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', padding: '12px', border: '1px dashed var(--app-border-2)', borderRadius: 'var(--radius-md)' }}>
                            <div style={{ fontSize: '24px', color: '#3b82f6', marginTop: '-4px' }}><i className="bi bi-building-fill-gear"></i></div>
                            <div style={{ flex: 1 }}>
                                <h6 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Smart Room Reallocation</h6>
                                <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: 0, marginBottom: '10px' }}>
                                    Detect sub-optimal room usage (e.g., small classes in large halls) and suggest room swaps.
                                </p>
                                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => toast.info('Smart Room Reallocation is coming soon!')}>
                                    <i className="bi bi-play-circle me-1"></i> Run Analysis
                                </button>
                            </div>
                        </div>
                    </div>
                </SettingsSection>

            </div>
        </div>
    );
};

export default Settings;
