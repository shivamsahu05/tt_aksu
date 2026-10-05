import React, { useState, useEffect } from 'react';


const renderRoomBadge = (rStr) => {
    if (!rStr) return null;
    if (rStr.includes(' - ')) {
        const parts = rStr.split(' - ');
        const room = parts[0];
        const block = parts[1];
        return (
            <span className="d-inline-flex align-items-center">
                [{room}]
                <span className="badge bg-warning text-dark border border-warning ms-1 px-1 py-0 shadow-sm" style={{ fontSize: '0.65rem', lineHeight: '1.2' }}>{block}</span>
            </span>
        );
    }
    return <span>[{rStr}]</span>;
};

const formatRoomName = (entry) => {
    if (!entry || !entry.room_number) return null;
    if (entry.room_building_id && entry.class_building_id && entry.room_building_id !== entry.class_building_id) {
        return `${entry.room_number} - ${entry.room_building_name || 'Other Block'}`;
    }
    return entry.room_number;
};



const isSelfLearningEntry = (e) => {
    if (!e) return false;
    const name = String(e.subject_name || '').toLowerCase();
    const code = String(e.subject_code || '').toUpperCase();
    return name.includes('self learning') || code === 'SL';
};

const isRemedialEntry = (e) => {
    if (!e) return false;
    const name = String(e.subject_name || '').toLowerCase();
    const code = String(e.subject_code || '').toUpperCase();
    return name.includes('remedial') || code === 'REM' || code === 'REMEDIAL';
};

import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../utils/api';
import { toast } from 'react-toastify';
import PageHeader from '../../components/common/PageHeader';
import Swal from 'sweetalert2';
import TimetableGrid from '../../components/timetable/TimetableGrid';
import TeacherConstraintsModal from '../../components/timetable/TeacherConstraintsModal';
import UnassignedWorkloadsModal from '../../components/timetable/UnassignedWorkloadsModal';
import ManualEditModal from '../../components/timetable/ManualEditModal';
import TimetableHistoryModal from '../../components/timetable/TimetableHistoryModal';
import HiddenSlotsModal from '../../components/timetable/HiddenSlotsModal';
import GapAnalysisModal from '../../components/timetable/GapAnalysisModal';
import * as XLSX from 'xlsx';

const getSubjectColor = (subjectStr) => {
    if (!subjectStr) return { bg: 'var(--bs-primary-bg-subtle)', border: 'var(--bs-primary-border-subtle)', text: 'var(--bs-primary-text-emphasis)' };
    let hash = 0;
    for (let i = 0; i < subjectStr.length; i++) {
        hash = subjectStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return {
        bg: `hsl(${hue}, 85%, 95%)`,
        border: `hsl(${hue}, 80%, 85%)`,
        text: `hsl(${hue}, 85%, 25%)`
    };
};

const isNptelSubject = (item) => {
    if (!item) return false;
    return (
        Number(item.is_nptel) === 1 ||
        String(item.subject_code || '').toUpperCase().includes('MOOC') ||
        String(item.subject_name || '').toUpperCase().includes('MOOC') ||
        String(item.subject_code || '').toUpperCase().includes('NPTEL') ||
        String(item.subject_name || '').toUpperCase().includes('NPTEL') ||
        String(item.subject_code || '').toUpperCase().includes('SWAYAM') ||
        String(item.subject_name || '').toUpperCase().includes('SWAYAM')
    );
};

const getShortSubjectName = (name) => {
    if (!name) return '';
    const clean = String(name).trim();
    if (clean.length <= 15) return clean;

    // Auto-acronym for long names
    const skipWords = ['and', 'in', 'of', 'for', 'to', 'with', 'the', '&'];
    const parts = clean.split(/[\s-]+/);
    if (parts.length > 2) {
        return parts
            .filter(p => !skipWords.includes(p.toLowerCase()) && p.length > 0)
            .map(p => p[0].toUpperCase())
            .join('');
    }
    return clean;
};

const TimetableManager = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const isDeptAdmin = user?.role === 'DEPARTMENT_ADMIN';

    const [sessions, setSessions] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [classes, setClasses] = useState([]);
    const [sections, setSections] = useState([]);

    // For Department Master Grid
    const [departmentSections, setDepartmentSections] = useState([]);
    const [generationInfo, setGenerationInfo] = useState(null);
    const [departmentTimetable, setDepartmentTimetable] = useState([]);
    const [loadingAllocations, setLoadingAllocations] = useState(false);
    const [schema, setSchema] = useState({ days: [], slots: [] });

    const [selectedSession, setSelectedSession] = useState('');
    const [selectedDepartment, setSelectedDepartment] = useState(isDeptAdmin ? user.department_id : '');
    const [selectedClass, setSelectedClass] = useState('');
    const [selectedSection, setSelectedSection] = useState('');
    const [sectionInfo, setSectionInfo] = useState(null);

    const [timetable, setTimetable] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showTeacherModal, setShowTeacherModal] = useState(false);
    const [showUnassignedModal, setShowUnassignedModal] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [viewingHistoryBatch, setViewingHistoryBatch] = useState(null);
    const [showManualEditModal, setShowManualEditModal] = useState(false);
    const [showHiddenModal, setShowHiddenModal] = useState(false);
    const [editingEntries, setEditingEntries] = useState([]);
    const [editMeta, setEditMeta] = useState(null);
    const [showGapAnalysisModal, setShowGapAnalysisModal] = useState(false);

    useEffect(() => {
        api.get('/sessions?limit=100').then(res => {
            if (res.data.success) {
                setSessions(res.data.data);
                const active = res.data.data.find(s => s.is_active);
                if (active) setSelectedSession(active.id.toString());
            }
        }).catch(() => { });
        api.get('/departments?limit=100').then(res => {
            if (res.data.success) setDepartments(res.data.data);
        }).catch(() => { });
        api.get('/timetable/schema').then(res => {
            if (res.data.success) setSchema(res.data.data);
        }).catch(() => { });
    }, []);

    useEffect(() => {
        if (!selectedSession) { setClasses([]); return; }
        api.get(`/classes?session_id=${selectedSession}&limit=100`).then(res => {
            if (res.data.success) setClasses(res.data.data);
        }).catch(() => { });
        setSelectedClass('');
        setSelectedSection('');
        setSectionInfo(null);
    }, [selectedSession]);

    useEffect(() => {
        if (!selectedClass) { setSections([]); return; }
        api.get(`/classes/${selectedClass}`).then(res => {
            if (res.data.success) setSections(res.data.data.sections || []);
        }).catch(() => { });
        setSelectedSection('');
        setSectionInfo(null);
    }, [selectedClass]);

    useEffect(() => {
        if (!selectedSection) { setSectionInfo(null); return; }
        const s = sections.find(sec => sec.id.toString() === selectedSection.toString());
        setSectionInfo(s || null);
    }, [selectedSection, sections]);

    // Fetch Department Timetable and Sections when Session is selected (and optionally Department)
    useEffect(() => {
        if (selectedSession) {
            setLoadingAllocations(true);
            const timestamp = Date.now();
            const deptParam = selectedDepartment ? `&department_id=${selectedDepartment}` : '';
            Promise.all([
                api.get(`/timetable?session_id=${selectedSession}${deptParam}&_t=${timestamp}`),
                api.get(`/classes/all-sections?session_id=${selectedSession}${deptParam}`)
            ])
                .then(([ttRes, secRes]) => {
                    if (ttRes.data.success) {
                        setDepartmentTimetable(ttRes.data.data);
                        setGenerationInfo(ttRes.data.generationInfo || null);
                    }
                    if (secRes.data.success) setDepartmentSections(secRes.data.data || []);
                })
                .catch(() => toast.error('Failed to load master timetable'))
                .finally(() => setLoadingAllocations(false));
        } else {
            setDepartmentTimetable([]);
            setDepartmentSections([]);
            setGenerationInfo(null);
        }
        setViewingHistoryBatch(null);
    }, [selectedDepartment, selectedSession]);

    const fetchTimetable = async () => {
        const timestamp = Date.now();
        const batchParam = viewingHistoryBatch ? `&batch_id=${viewingHistoryBatch}` : '';

        if (selectedSession && selectedSection) {
            setLoading(true);
            try {
                const res = await api.get(`/timetable?session_id=${selectedSession}&section_id=${selectedSection}&_t=${timestamp}${batchParam}`);
                if (res.data.success) setTimetable(res.data.data);
            } catch { toast.error('Failed to load timetable'); }
            finally { setLoading(false); }
        }

        if (selectedDepartment && selectedSession) {
            setLoadingAllocations(true);
            try {
                const res = await api.get(`/timetable?session_id=${selectedSession}&department_id=${selectedDepartment}&_t=${timestamp}${batchParam}`);
                if (res.data.success) {
                    setDepartmentTimetable(res.data.data);
                    setGenerationInfo(res.data.generationInfo || null);
                }
            } catch { toast.error('Failed to reload department master timetable'); }
            finally { setLoadingAllocations(false); }
        }
    };

    // Re-fetch when viewingHistoryBatch changes
    useEffect(() => {
        if (selectedSession) {
            fetchTimetable();
        }
    }, [viewingHistoryBatch]);

    useEffect(() => {
        if (selectedSession && selectedSection) fetchTimetable();
        else setTimetable([]);
    }, [selectedSession, selectedSection]);

    const handleGenerate = async () => {
        if (!selectedSession) { toast.warning('Please select an Academic Session first.'); return; }

        const { value: formValues } = await Swal.fire({
            title: 'Generate Timetable',
            html: `
                <div class="text-start">
                    <p class="text-muted small mb-3">Select the scope. This will overwrite existing entries for the selected scope.</p>
                    <div class="mb-2">
                        <label class="form-label fw-semibold small">Scope</label>
                        <select id="swal-scope" class="form-select">
                            <option value="department" selected>Selected Department Only</option>
                            <option value="class">Selected Class Only</option>
                        </select>
                    </div>
                </div>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: '<i class="bi bi-magic me-1"></i> Generate',
            confirmButtonColor: '#6366f1',
            cancelButtonColor: '#64748b',
            preConfirm: () => {
                const scope = document.getElementById('swal-scope').value;
                if (scope === 'class' && !selectedClass) {
                    Swal.showValidationMessage('Please select a class first.');
                    return false;
                }
                if (scope === 'department' && !selectedDepartment) {
                    Swal.showValidationMessage('Please select a department first.');
                    return false;
                }
                return { scope };
            }
        });

        if (formValues) {
            let target_id = null;
            if (formValues.scope === 'class') target_id = parseInt(selectedClass);
            if (formValues.scope === 'department') target_id = parseInt(selectedDepartment);

            // Check if existing timetable entries exist for this specific scope
            try {
                const timestamp = Date.now();
                let checkUrl = `/timetable?session_id=${selectedSession}&_t=${timestamp}`;
                if (formValues.scope === 'department' && target_id) checkUrl += `&department_id=${target_id}`;
                else if (formValues.scope === 'class' && selectedSection) checkUrl += `&section_id=${selectedSection}`;

                const checkRes = await api.get(checkUrl);
                const hasExisting = checkRes.data.success && checkRes.data.data && checkRes.data.data.length > 0;

                if (hasExisting) {
                    const confirmResult = await Swal.fire({
                        title: '⚠️ Existing Timetable Found',
                        html: `
                            <div class="text-start">
                                <p class="mb-2">A timetable was already generated for this scope.</p>
                                <div class="alert alert-warning border-0 rounded-3 py-2 px-3 small text-start">
                                    <i class="bi bi-exclamation-triangle-fill me-2"></i>
                                    Regenerating will <strong>overwrite</strong> the existing timetable entries for the selected scope. 
                                    Any manual edits or adjustments made previously will be <strong>lost</strong>.
                                </div>
                                <p class="text-muted small mb-0">Do you want to continue and generate a new timetable?</p>
                            </div>
                        `,
                        icon: 'warning',
                        showCancelButton: true,
                        confirmButtonText: '<i class="bi bi-arrow-clockwise me-1"></i> Yes, Regenerate',
                        cancelButtonText: 'Cancel',
                        confirmButtonColor: '#f59e0b',
                        cancelButtonColor: '#64748b',
                    });
                    if (!confirmResult.isConfirmed) return;
                }
            } catch (e) {
                // If check fails, proceed anyway
            }

            // Premium Phase-wise generation UI
            const phases = [
                { phase: 1, icon: '<i class="bi bi-search"></i>', label: 'Phase 1: Analysis & Loading', desc: 'Analyzing total slots, subject credits & class capacities...', color: '#3b82f6', barColor: 'linear-gradient(90deg, #3b82f6, #60a5fa)', bg: '#eff6ff' },
                { phase: 2, icon: '<i class="bi bi-magic"></i>', label: 'Phase 2: Slot Arrangement', desc: 'Arranging slots accurately to minimize gaps & clashes...', color: '#8b5cf6', barColor: 'linear-gradient(90deg, #8b5cf6, #a78bfa)', bg: '#f5f3ff' }
            ];

            let phaseInterval;
            let currentPhaseIdx = 0;

            Swal.fire({
                html: `
                    <div style="font-family:'Inter', sans-serif; padding: 10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 24px;">
                            <h3 style="margin:0; font-size:1.25rem; font-weight:700; color:#1e293b; display:flex; align-items:center; gap:8px;">
                                <i class="bi bi-cpu text-primary"></i> AI Generation
                            </h3>
                            <div style="background:#f1f5f9; padding:4px 12px; border-radius:20px; font-weight:700; color:#475569; font-size:0.9rem; font-variant-numeric: tabular-nums; display:flex; align-items:center; gap:6px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.05);">
                                <i class="bi bi-stopwatch text-danger"></i> <span id="time-left">00:20</span>
                            </div>
                        </div>

                        <div style="background:#fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); margin-bottom: 24px;">
                            <div id="phase-label" style="font-size:1rem; font-weight:700; color:#3b82f6; margin-bottom:6px; display:flex; align-items:center; gap:8px;">
                                <i class="bi bi-search"></i> Phase 1: Analysis & Loading
                            </div>
                            <div id="phase-desc" style="font-size:0.85rem; color:#64748b; margin-bottom:16px;">Analyzing total slots, subject credits & class capacities...</div>
                            
                            <div style="background:#f1f5f9; border-radius:10px; height:8px; overflow:hidden; margin-bottom:12px; position: relative;">
                                <div id="phase-bar" style="position:absolute; top:0; left:0; height:100%; width:0%; background:linear-gradient(90deg, #3b82f6, #60a5fa); border-radius:10px; transition:width 0.1s linear, background 0.5s ease;"></div>
                                <div style="position:absolute; top:0; left:0; height:100%; width:100%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent); animation: shimmer 1.5s infinite; transform: translateX(-100%); z-index: 2;"></div>
                            </div>
                            <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:#94a3b8; font-weight:600;">
                                <span id="progress-pct">0%</span>
                                <span id="phase-status" style="color:#64748b; font-style:italic;">Initializing...</span>
                            </div>
                        </div>

                        <div style="display:flex; gap: 12px;">
                            ${phases.map((p, i) => `
                                <div id="phase-step-${i}" style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:12px 8px; border-radius:10px; background:${i===0?p.bg:'#f8fafc'}; border:1px solid ${i===0?p.color+'40':'#e2e8f0'}; transition:all 0.4s ease;">
                                    <div style="font-size:1.5rem; margin-bottom:6px; color:${i===0?p.color:'#cbd5e1'}; transition:color 0.4s ease;">
                                        ${p.icon}
                                    </div>
                                    <div style="font-size:0.75rem; font-weight:700; color:${i===0?p.color:'#94a3b8'}; transition:color 0.4s ease;">PHASE ${p.phase}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <style>
                        @keyframes shimmer { 100% { transform: translateX(100%); } }
                        .swal2-popup { border-radius: 16px !important; }
                    </style>
                `,
                allowOutsideClick: false,
                showConfirmButton: false,
                width: 500,
                padding: '1.5em',
                didOpen: () => {
                    const bar = document.getElementById('phase-bar');
                    const label = document.getElementById('phase-label');
                    const desc = document.getElementById('phase-desc');
                    const status = document.getElementById('phase-status');
                    const timerEl = document.getElementById('time-left');
                    const pctEl = document.getElementById('progress-pct');

                    // 10 seconds per phase (total 20s)
                    const phaseDurations = [10000, 10000];
                    let elapsed = 0;
                    const totalDuration = phaseDurations.reduce((a, b) => a + b, 0);

                    const statusMessages = [
                        [
                            'Scanning active classes & batches...',
                            'Calculating required slots...',
                            'Analyzing subject credits...',
                            'Validating teacher availability...',
                            'Loading room capacities...'
                        ],
                        [
                            'Creating parallel blocks...',
                            'Arranging core subjects...',
                            'Allocating labs & multi-slots...',
                            'Optimizing teacher workloads...',
                            'Finalizing accurate layout...'
                        ]
                    ];

                    let msgTimers = [];

                    function enterPhase(idx) {
                        currentPhaseIdx = idx;
                        const p = phases[idx];
                        if (label) { label.innerHTML = `${p.icon} ${p.label}`; label.style.color = p.color; }
                        if (desc) { desc.innerText = p.desc; }
                        if (bar) bar.style.background = p.barColor;

                        // Update step indicators
                        phases.forEach((_, i) => {
                            const stepEl = document.getElementById(`phase-step-${i}`);
                            if (!stepEl) return;
                            if (i < idx) {
                                stepEl.style.background = '#f8fafc';
                                stepEl.style.border = `1px solid #e2e8f0`;
                                stepEl.style.opacity = '0.5';
                                stepEl.querySelector('div:first-child').style.color = phases[i].color;
                                stepEl.querySelector('div:last-child').style.color = phases[i].color;
                            } else if (i === idx) {
                                stepEl.style.background = p.bg;
                                stepEl.style.border = `1px solid ${p.color}40`;
                                stepEl.style.opacity = '1';
                                stepEl.querySelector('div:first-child').style.color = p.color;
                                stepEl.querySelector('div:last-child').style.color = p.color;
                            } else {
                                stepEl.style.background = '#f8fafc';
                                stepEl.style.border = '1px solid #e2e8f0';
                                stepEl.style.opacity = '1';
                                stepEl.querySelector('div:first-child').style.color = '#cbd5e1';
                                stepEl.querySelector('div:last-child').style.color = '#94a3b8';
                            }
                        });

                        // Cycle status messages
                        const msgs = statusMessages[idx];
                        let mi = 0;
                        if (status) status.innerText = msgs[mi];
                        const t = setInterval(() => {
                            mi = (mi + 1) % msgs.length;
                            if (status) status.innerText = msgs[mi];
                        }, phaseDurations[idx] / msgs.length);
                        msgTimers.push(t);
                    }

                    enterPhase(0);

                    phaseInterval = setInterval(() => {
                        elapsed += 50; // Update every 50ms for smooth progress
                        const overallPct = Math.min((elapsed / totalDuration) * 100, 99);
                        if (bar) bar.style.width = `${overallPct}%`;
                        if (pctEl) pctEl.innerText = `${Math.floor(overallPct)}%`;

                        // Update Timer
                        const remainingSec = Math.max(0, Math.ceil((totalDuration - elapsed) / 1000));
                        if (timerEl) {
                            timerEl.innerText = `00:${remainingSec.toString().padStart(2, '0')}`;
                        }

                        // Transition to Phase 2 at exactly 10s
                        if (elapsed === phaseDurations[0]) {
                            enterPhase(1);
                        }
                    }, 50);
                },
                willClose: () => {
                    clearInterval(phaseInterval);
                }
            });

            // Phase 1 (Analysis): Wait for 10 seconds before generating
            await new Promise(resolve => setTimeout(resolve, 10000));

            try {
                // Phase 2 (Arrangement): Start generation API
                const generatePromise = api.post('/timetable/generate', {
                    session_id: parseInt(selectedSession),
                    scope: formValues.scope,
                    target_id: target_id,
                    overwrite: true
                });
                
                // Ensure Phase 2 takes exactly 10 seconds visually, even if API finishes early
                const waitPromise = new Promise(resolve => setTimeout(resolve, 10000));
                
                const [res] = await Promise.all([generatePromise, waitPromise]);

                // Complete the bar animation before closing
                const bar = document.getElementById('phase-bar');
                if (bar) bar.style.width = '100%';
                const label = document.getElementById('phase-label');
                if (label) { label.innerText = '✅ Generation Complete!'; label.style.color = '#22c55e'; }
                await new Promise(r => setTimeout(r, 400));

                if (res.data.success) {
                    Swal.fire({
                        title: 'Success!',
                        html: `<div style="font-size:0.95rem">${res.data.message}</div>`,
                        icon: 'success',
                        confirmButtonColor: '#6366f1'
                    });
                    fetchTimetable();
                }
            } catch (err) {
                Swal.fire('Error', err.response?.data?.message || 'Generation failed', 'error');
            }
        }
    };

    const selectedSessionObj = sessions.find(s => s.id.toString() === selectedSession);
    const selectedClassObj = classes.find(c => c.id.toString() === selectedClass);

    const hiddenSlotsCount = (selectedSection ? timetable : departmentTimetable).filter(s => s.is_hidden === 1 || s.is_hidden === true).length;

    return (
        <div>
            <PageHeader
                title="Timetable Generator"
                subtitle="Create, manage, and optimize class schedules"
                icon="bi-calendar-week"
                rightContent={
                    <div className="d-flex align-items-center gap-2 flex-wrap flex-sm-nowrap">
                        <select
                            className="form-select bg-white"
                            style={{ minWidth: '160px', width: 'auto' }}
                            value={selectedSession}
                            onChange={e => setSelectedSession(e.target.value)}
                        >
                            <option value="">Select Session...</option>
                            {sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        <button
                            className="btn btn-outline-warning text-nowrap"
                            title={!selectedSession || !selectedDepartment ? 'Select Session and Department first' : 'Analyse gaps in timetable'}
                            disabled={!selectedSession || !selectedDepartment}
                            onClick={() => setShowGapAnalysisModal(true)}
                        >
                            <i className="bi bi-bar-chart-steps me-1"></i> <span className="d-none d-sm-inline">Analyse Gaps</span>
                        </button>
                        <button
                            className="btn btn-outline-primary text-nowrap"
                            onClick={() => {
                                if (!selectedSession || !selectedDepartment) {
                                    toast.warning("Please select Session and Department first to view history.");
                                    return;
                                }
                                setShowHistoryModal(true);
                            }}
                        >
                            <i className="bi bi-clock-history me-1"></i> <span className="d-none d-sm-inline">View History</span>
                        </button>
                    </div>
                }
                actionButton={{
                    label: "Generate Timetable",
                    icon: "bi-magic",
                    onClick: handleGenerate
                }}
            />

            {/* Filter Bar */}
            <div style={{
                background: 'var(--app-surface)',
                border: '1px solid var(--app-border)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-sm)',
                padding: '16px 20px',
                marginBottom: '16px'
            }}>
                <div className="row g-3 align-items-end">
                    {!isDeptAdmin && (
                        <div className="col-12 col-md-4">
                            <label className="form-label text-muted small fw-semibold">Department</label>
                            <select className="form-select" value={selectedDepartment} onChange={e => { setSelectedDepartment(e.target.value); setSelectedClass(''); }}>
                                <option value="">All Departments</option>
                                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                        </div>
                    )}
                    <div className="col-12 col-md-3">
                        <label className="form-label text-muted small fw-semibold">Class / Program</label>
                        <select className="form-select" value={selectedClass} onChange={e => setSelectedClass(e.target.value)} disabled={!selectedDepartment || !selectedSession}>
                            <option value="">All Classes</option>
                            {classes.filter(c => !selectedDepartment || c.department_id?.toString() === selectedDepartment.toString()).map(c => <option key={c.id} value={c.id}>{c.semester} {c.program_name}</option>)}
                        </select>
                    </div>
                    <div className="col-12 col-md-5 text-md-end d-flex gap-2 flex-wrap justify-content-md-end">
                        <button className="btn btn-outline-primary flex-grow-1 flex-md-grow-0" disabled={!selectedDepartment} onClick={() => setShowTeacherModal(true)}>
                            <i className="bi bi-person-lines-fill me-1" /> Constraints
                        </button>
                        <button className="btn btn-outline-warning text-dark border-warning flex-grow-1 flex-md-grow-0" onClick={() => setShowUnassignedModal(true)}>
                            <i className="bi bi-exclamation-triangle me-1" /> Unassigned
                        </button>
                        {hiddenSlotsCount > 0 && (
                            <button className="btn btn-outline-secondary text-secondary flex-grow-1 flex-md-grow-0" onClick={() => setShowHiddenModal(true)}>
                                <i className="bi bi-eye-slash me-1" /> Hidden Slots
                            </button>
                        )}
                        <button className="btn btn-secondary flex-grow-1 flex-md-grow-0" onClick={() => {
                            let url = '/admin/timetable/reports';
                            const params = new URLSearchParams();
                            if (selectedSession) params.append('session_id', selectedSession);
                            if (selectedDepartment) params.append('department_id', selectedDepartment);
                            if (params.toString()) url += `?${params.toString()}`;
                            navigate(url);
                        }}>
                            <i className="bi bi-printer me-1" /> Reports
                        </button>
                    </div>
                </div>

                {/* Section info strip */}
                {sectionInfo && (
                    <div style={{
                        display: 'flex', gap: '20px', flexWrap: 'wrap',
                        marginTop: '12px', paddingTop: '12px',
                        borderTop: '1px solid var(--app-border-2)'
                    }}>
                        {[
                            { icon: 'bi-people-fill', label: 'Students', value: sectionInfo.student_strength || '—' },
                            { icon: 'bi-diagram-3', label: 'Section', value: sectionInfo.section_name },
                            { icon: 'bi-book', label: 'Program', value: selectedClassObj?.program_name },
                            { icon: 'bi-calendar2', label: 'Session', value: selectedSessionObj?.name },
                        ].map(info => (
                            <div key={info.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <i className={`bi ${info.icon}`} style={{ color: 'var(--accent)', fontSize: '13px' }} />
                                <span style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>{info.label}:</span>
                                <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>{info.value}</span>
                            </div>
                        ))}
                        <div style={{ flex: 1, textAlign: 'right' }}>
                            <span style={{
                                fontSize: '11.5px', color: 'var(--text-muted)',
                                background: 'var(--primary-50)', border: '1px solid var(--primary-100)',
                                borderRadius: '5px', padding: '2px 8px'
                            }}>
                                {timetable.length} slots assigned
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* Timetable Grid */}
            {selectedSection ? (
                <div style={{
                    background: 'var(--app-surface)',
                    border: '1px solid var(--app-border)',
                    borderRadius: 'var(--radius-lg)',
                    boxShadow: 'var(--shadow-sm)',
                    overflow: 'hidden'
                }}>
                    {/* Grid header */}
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '12px 16px', borderBottom: '1px solid var(--app-border-2)',
                        background: 'var(--app-surface-2)'
                    }}>
                        <div style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>
                            Timetable — {selectedClassObj?.program_name} · Section {sectionInfo?.section_name}
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={fetchTimetable}
                                title="Refresh"
                            >
                                <i className="bi bi-arrow-clockwise" /> Refresh
                            </button>
                        </div>
                    </div>

                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '60px 24px' }}>
                            <div style={{
                                width: '36px', height: '36px', borderRadius: '50%',
                                border: '3px solid var(--app-border)', borderTopColor: 'var(--primary-600)',
                                animation: 'spin 0.7s linear infinite', margin: '0 auto 12px'
                            }} />
                            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading timetable…</p>
                            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                        </div>
                    ) : (
                        <TimetableGrid
                            timetable={timetable}
                            sessionId={selectedSession}
                            sectionId={selectedSection}
                            sectionInfo={sectionInfo}
                            onRefresh={fetchTimetable}
                        />
                    )}
                </div>
            ) : selectedSession && !selectedSection ? (
                (() => {
                    const displaySectionsGlobal = selectedClass
                        ? departmentSections.filter(s => s.class_id?.toString() === selectedClass?.toString())
                        : departmentSections;
                    
                    const sectionsByDept = {};
                    displaySectionsGlobal.forEach(s => {
                        const dId = s.department_id || 'Unknown';
                        if (!sectionsByDept[dId]) {
                            sectionsByDept[dId] = {
                                id: dId,
                                name: s.department_name || (departments.find(d => d.id.toString() === dId.toString())?.name) || 'All Departments',
                                sections: []
                            };
                        }
                        sectionsByDept[dId].sections.push(s);
                    });

                    const deptEntries = Object.values(sectionsByDept).sort((a, b) => a.name.localeCompare(b.name));

                    if (loadingAllocations) {
                        return (
                            <div className="text-center py-5">
                                <div className="spinner-border text-primary"></div>
                                <div className="mt-2 text-muted small">Loading master timetable...</div>
                            </div>
                        );
                    }

                    if (deptEntries.length === 0 || !schema.days?.length) {
                        return (
                            <div className="text-center py-5 text-muted">
                                <i className="bi bi-inbox fs-1 d-block mb-3"></i>
                                No classes or timetable data found for this selection in the selected session.
                            </div>
                        );
                    }

                    const globalDepartmentTimetable = departmentTimetable;

                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                            {deptEntries.map((dept, deptIndex) => {
                                const departmentSections = dept.sections;
                                const deptTimetableIds = new Set(departmentSections.map(s => s.id));
                                const departmentTimetable = globalDepartmentTimetable.filter(t => deptTimetableIds.has(t.section_id));
                                
                                return (
                                    <div key={dept.id}>
                                    <div style={{
                                        background: 'var(--app-surface)',
                                        border: '1px solid var(--app-border)',
                                        borderRadius: 'var(--radius-lg)',
                                        boxShadow: 'var(--shadow-sm)',
                                        padding: '0',
                                        overflow: 'hidden'
                                    }}>
                                        <div style={{ padding: '24px 24px 0 24px' }}>
                                            <h4 className="fw-bold text-primary mb-3">{dept.name}</h4>
                                            <h5 className="fw-bold mb-4">
                                                <i className="bi bi-grid-3x3 me-2 text-primary"></i>
                                                Department Master Timetable Overview
                            {generationInfo && !viewingHistoryBatch && (
                                <span className="ms-3 text-muted d-inline-block" style={{ fontSize: '0.75rem', fontWeight: 'normal' }}>
                                    (Current: {new Date(generationInfo.current).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase()}
                                    {generationInfo.previous && ` | Previous: ${new Date(generationInfo.previous).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase()}`})
                                </span>
                            )}
                        </h5>

                        {viewingHistoryBatch && (
                            <div className="alert alert-warning py-2 mb-4 d-flex align-items-center justify-content-between">
                                <div>
                                    <i className="bi bi-clock-history me-2"></i>
                                    <strong>Viewing Historical Timetable</strong> (Read-Only)
                                </div>
                                <div>
                                    <button
                                        className="btn btn-sm btn-outline-success me-2"
                                        onClick={() => {
                                            const table = document.getElementById('timetable-master-grid');
                                            if (table) {
                                                const wb = XLSX.utils.table_to_book(table, { sheet: "Timetable" });
                                                XLSX.writeFile(wb, `Timetable_History_${new Date().getTime()}.xlsx`);
                                            }
                                        }}
                                    >
                                        <i className="bi bi-file-earmark-excel-fill me-1"></i> Excel
                                    </button>
                                    <button
                                        className="btn btn-sm btn-outline-dark me-2"
                                        onClick={() => window.print()}
                                    >
                                        <i className="bi bi-printer-fill me-1"></i> Print / Save PDF
                                    </button>
                                    <button
                                        className="btn btn-sm btn-warning fw-bold"
                                        onClick={() => setViewingHistoryBatch(null)}
                                    >
                                        Back to Current Active
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                        {(() => {
                            const displaySections = departmentSections;

                            // --- B1/B2/B3 display name helper ---
                            const classIdToSections = {};
                            departmentSections.forEach(s => {
                                if (!classIdToSections[s.class_id]) classIdToSections[s.class_id] = [];
                                classIdToSections[s.class_id].push(s.id);
                            });
                            const getSectionDisplayName = (sec) => {
                                const siblings = classIdToSections[sec.class_id] || [];
                                if (siblings.length <= 1) return `${sec.semester} ${sec.program_name}`;
                                const sortedSiblings = [...siblings].sort((a, b) => a - b);
                                const idx = sortedSiblings.indexOf(sec.id);
                                return `${sec.semester} ${sec.program_name} B${idx + 1}`;
                            };

                            // --- Build rows: single or merged ---
                            const processedGroupIds = new Set();
                            const rows = [];
                            displaySections.forEach(sec => {
                                if (sec.merge_group_id) {
                                    if (!processedGroupIds.has(sec.merge_group_id)) {
                                        processedGroupIds.add(sec.merge_group_id);
                                        const groupSections = displaySections.filter(s => s.merge_group_id === sec.merge_group_id);
                                        rows.push({ type: 'merged', groupId: sec.merge_group_id, sections: groupSections });
                                    }
                                } else {
                                    rows.push({ type: 'single', sections: [sec] });
                                }
                            });

                            if (rows.length === 0) return (
                                <div className="text-center py-5 text-muted">
                                    <i className="bi bi-inbox fs-1 d-block mb-3"></i>
                                    No classes or timetable data found for this selection.
                                </div>
                            );

                            return (
                                <div className="table-responsive report-scroll-container" style={{ width: '100%', overflowX: 'auto', overflowY: 'auto' }}>
                                    <style>{`
                                        .report-scroll-container { max-height: 720px; }
                                        .report-table th, .report-table td { padding: 4px !important; }
                                        @media (max-width: 768px) {
                                            .report-scroll-container { max-height: 1400px; }
                                            .report-table th, .report-table td { position: static !important; }
                                        }
                                    `}</style>
                                    <table id="timetable-master-grid" className="table table-bordered text-center align-middle report-table m-0" style={{ minWidth: '1200px', fontSize: '0.85rem' }}>
                                        <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                                            <tr>
                                                <th className="bg-light" style={{ width: '60px', position: 'sticky', left: 0, zIndex: 3 }}>Day</th>
                                                <th className="bg-light text-start" style={{ width: '150px' }}>Class</th>
                                                {schema.slots.map(s => (
                                                    <th key={s.id} className="bg-light text-nowrap" style={{ minWidth: '100px', whiteSpace: 'nowrap' }}>
                                                        <div>{s.slot_type === 'break' ? 'BREAK' : `P${s.slot_order}`}</div>
                                                        <div className="small text-muted fw-normal">{s.start_time.substring(0, 5)}</div>
                                                    </th>
                                                ))}
                                                <th className="bg-light" style={{ width: '100px' }}>Room</th>
                                                <th className="bg-light" style={{ width: '150px' }}>Strength / Cap</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {schema.days.flatMap((day, dayIdx) => {
                                                return rows.map((row, rowIdx) => {
                                                    const isFirstRow = rowIdx === 0;
                                                    const skipSlotIds = new Set();
                                                    const isMerged = row.type === 'merged';
                                                    const primarySec = row.sections[0];
                                                    const allSectionIds = row.sections.map(s => s.id);

                                                    // Merged row label
                                                    const getShortMergedName = (sectionsArray) => {
                                                        const names = sectionsArray.map(s => getSectionDisplayName(s));
                                                        const firstParts = names[0].split(' ');
                                                        let commonPrefixLength = 0;
                                                        for (let i = 0; i < firstParts.length; i++) {
                                                            const prefix = firstParts.slice(0, i + 1).join(' ');
                                                            if (names.every(n => n.startsWith(prefix))) {
                                                                commonPrefixLength = prefix.length;
                                                            } else {
                                                                break;
                                                            }
                                                        }
                                                        if (commonPrefixLength > 0) {
                                                            const prefix = names[0].substring(0, commonPrefixLength);
                                                            const suffixes = names.map(n => n.substring(commonPrefixLength).trim());
                                                            return `${prefix} ${suffixes.join(' & ')}`.trim();
                                                        }
                                                        return names.join(' & ');
                                                    };

                                                    const rowLabel = isMerged
                                                        ? getShortMergedName(row.sections)
                                                        : getSectionDisplayName(primarySec);

                                                    const roomLabel = isMerged
                                                        ? [...new Set(row.sections.map(s => s.room_number || '-'))].join(' / ')
                                                        : (primarySec.room_number || '-');

                                                    const strengthLabel = isMerged
                                                        ? `${row.sections.reduce((sum, s) => sum + (s.student_strength || 0), 0)} / ${Array.from(new Map(row.sections.filter(s => s.room_number).map(s => [s.room_number, s.capacity || 0])).values()).reduce((a, b) => a + b, 0) || '-'}`
                                                        : `${primarySec.student_strength || '-'} / ${primarySec.capacity || '-'}`;

                                                    return (
                                                        <tr key={`${day.id}-${isMerged ? `mg${row.groupId}` : primarySec.id}`} className={dayIdx > 0 && rowIdx === 0 ? "day-divider-row" : ""}>
                                                            {isFirstRow && (
                                                                <td rowSpan={rows.length} className="bg-light p-0 align-top text-center" style={{ width: '60px', position: 'sticky', left: 0, zIndex: 1 }}>
                                                                    <div style={{ position: 'sticky', top: '100px', writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontWeight: 'bold', margin: 'auto', paddingTop: '20px', paddingBottom: '20px' }}>
                                                                        {day.name.toUpperCase()}
                                                                    </div>
                                                                </td>
                                                            )}
                                                            <td className="fw-bold bg-light align-middle text-start" style={{ whiteSpace: 'nowrap', fontSize: isMerged ? '0.78rem' : '0.85rem' }}>
                                                                {rowLabel}
                                                            </td>
                                                            {schema.slots.map((slot, index) => {
                                                                if (skipSlotIds.has(slot.id)) return null;

                                                                if (slot.slot_type === 'break') {
                                                                    if (isFirstRow) {
                                                                        return (
                                                                            <td key={slot.id} rowSpan={rows.length} className="bg-light text-muted fw-bold p-0 align-top text-center" style={{ width: '60px' }}>
                                                                                <div style={{ position: 'sticky', top: '100px', writingMode: 'vertical-rl', transform: 'rotate(180deg)', margin: 'auto', paddingTop: '20px', paddingBottom: '20px' }}>
                                                                                    LUNCH
                                                                                </div>
                                                                            </td>
                                                                        );
                                                                    }
                                                                    return null;
                                                                }

                                                                if (!isMerged) {
                                                                    // Normal single-section rendering
                                                                    const cls = primarySec;
                                                                    const cellEntries = departmentTimetable.filter(t => t.day_id === day.id && t.slot_order === slot.slot_order && t.section_id === cls.id);
                                                                    let colSpan = 1;
                                                                    const isLabByCredit = (e) => {
                                                                        if (!e) return false;
                                                                        const aType = String(e.allocation_type || '').toLowerCase();
                                                                        const sType = String(e.subject_type || '').toLowerCase();
                                                                        const pCredit = Number(e.p_credit || e.weekly_practicals || 0);
                                                                        return aType === 'lab' || (aType !== 'theory' && (sType === 'lab' || sType === 'practical' || pCredit > 0 || Boolean(e.lab_group_id)));
                                                                    };
                                                                    const labEntry = cellEntries.find(e => isLabByCredit(e));
                                                                    if (labEntry) {
                                                                        const nextSlot = schema.slots[index + 1];
                                                                        if (nextSlot && nextSlot.slot_type !== 'break') {
                                                                            const hasNextSlot = departmentTimetable.some(t =>
                                                                                ((labEntry.lab_group_id && t.lab_group_id === labEntry.lab_group_id) || t.subject_id === labEntry.subject_id) &&
                                                                                t.day_id === day.id && t.section_id === cls.id && t.time_slot_id === nextSlot.id
                                                                            );
                                                                            if (hasNextSlot) { colSpan = 2; skipSlotIds.add(nextSlot.id); }
                                                                        }
                                                                    }
                                                                    return (
                                                                        <td key={slot.id} colSpan={colSpan} className="p-1" style={{ minWidth: `${120 * colSpan}px` }}>
                                                                            {cellEntries.map((e, idx) => {
                                                                                const code = String(e.subject_code || '').trim().toUpperCase();
                                                                                const name = String(e.subject_name || '').trim().toLowerCase();
                                                                                const isLibrary = e.isLibrary === true || code === 'LIB' || name === 'library period' || name === 'library';
                                                                                const isRem = isRemedialEntry(e);
                                                                                const isSL = isSelfLearningEntry(e);
                                                                                const colorStyle = isLibrary
                                                                                    ? { bg: '#e8f4f8', border: '#90cce0', text: '#1a6b8a' }
                                                                                    : isRem ? { bg: '#fff3e0', border: '#ffcc80', text: '#e65100' }
                                                                                    : isSL ? { bg: '#e8f4f8', border: '#90cce0', text: '#1a6b8a' }
                                                                                    : getSubjectColor(e.subject_code);
                                                                                const isLab = !isLibrary && isLabByCredit(e);
                                                                                const baseName = e.subject_name || e.subject_code;
                                                                                const shortName = getShortSubjectName(baseName);
                                                                                const displayName = isLibrary ? 'Library' : isRem ? 'REMEDIAL' : isSL ? 'Self Learning' : (isLab ? (String(shortName || '').toLowerCase().includes('lab') ? shortName : `${shortName} Lab`) : (e.subject_code || e.subject_name || ''));

                                                                                const tags = [];
                                                                                if (!isLibrary && Number(e.is_online) === 1) tags.push('ONLINE');
                                                                                if (!isLibrary && isNptelSubject(e)) tags.push('MOOC');
                                                                                const tagStr = tags.length > 0 ? ` {${tags.join(', ')}}` : '';

                                                                                return (
                                                                                    <div key={idx}
                                                                                        className={`p-0 px-1 py-1 rounded ${idx < cellEntries.length - 1 ? 'mb-1' : ''} d-flex flex-column justify-content-center position-relative`}
                                                                                        style={{ backgroundColor: colorStyle.bg, border: `1px solid ${colorStyle.border}`, minHeight: '40px', overflow: 'hidden', opacity: e.is_hidden ? 0.4 : 1 }}
                                                                                        onMouseEnter={(ev) => ev.currentTarget.querySelector('.edit-btn')?.classList.remove('d-none')}
                                                                                        onMouseLeave={(ev) => ev.currentTarget.querySelector('.edit-btn')?.classList.add('d-none')}
                                                                                    >
                                                                                        {e.is_hidden === 1 || e.is_hidden === true ? (
                                                                                            <div className="position-absolute top-0 start-0 m-1">
                                                                                                <i className="bi bi-eye-slash-fill text-warning" title="Hidden from reports"></i>
                                                                                            </div>
                                                                                        ) : null}
                                                                                        <button
                                                                                            className="btn btn-sm btn-light border position-absolute top-0 end-0 m-1 edit-btn d-none"
                                                                                            style={{ padding: '1px 4px', fontSize: '10px', zIndex: 10 }}
                                                                                            onClick={() => {
                                                                                                setEditingEntries([e]);
                                                                                                setEditMeta({ day: day.name, time: `${slot.start_time} - ${slot.end_time}`, class: cls.section_name });
                                                                                                setShowManualEditModal(true);
                                                                                            }}
                                                                                            title="Edit Slot"
                                                                                        >
                                                                                            <i className="bi bi-pencil-fill text-primary"></i>
                                                                                        </button>
                                                                                        <div className="fw-bold text-truncate" style={{ color: colorStyle.text, fontSize: '12px' }} title={baseName}>
                                                                                            {displayName}
                                                                                            {e.room_number && !isLibrary && (isLab || e.room_number !== cls.room_number) && <span className="ms-1" style={{ fontSize: '12px' }}>[{e.room_number}]</span>}
                                                                                            {tags.length > 0 && <span className="text-primary ms-1">{tagStr}</span>}
                                                                                        </div>
                                                                                        {(!isLibrary && !isSL) && (
                                                                                            <div className="text-muted fw-bold text-truncate" style={{ fontSize: '13px' }} title={e.teacher_name}>
                                                                                                {isRem ? 'Class Teacher' : (isLab ? (e.teacher_name || e.teacher_short_name || 'N/A') : (e.teacher_short_name || 'N/A'))}
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </td>
                                                                    );
                                                                }

                                                                // --- MERGED ROW: gather all entries for all sections in this slot ---
                                                                const allEntries = allSectionIds.flatMap(secId =>
                                                                    departmentTimetable.filter(t => t.day_id === day.id && t.slot_order === slot.slot_order && t.section_id === secId)
                                                                );

                                                                // Lab colSpan check across any section in group
                                                                let colSpan = 1;
                                                                const isLabByCredit = (e) => {
                                                                    if (!e) return false;
                                                                    const aType = String(e.allocation_type || '').toLowerCase();
                                                                    const sType = String(e.subject_type || '').toLowerCase();
                                                                    const pCredit = Number(e.p_credit || e.weekly_practicals || 0);
                                                                    return aType === 'lab' || (aType !== 'theory' && (sType === 'lab' || sType === 'practical' || pCredit > 0 || Boolean(e.lab_group_id)));
                                                                };
                                                                const labEntry = allEntries.find(e => isLabByCredit(e));
                                                                if (labEntry) {
                                                                    const nextSlot = schema.slots[index + 1];
                                                                    if (nextSlot && nextSlot.slot_type !== 'break') {
                                                                        const hasNextSlot = allSectionIds.some(secId =>
                                                                            departmentTimetable.some(t =>
                                                                                ((labEntry.lab_group_id && t.lab_group_id === labEntry.lab_group_id) || t.subject_id === labEntry.subject_id) &&
                                                                                t.day_id === day.id && t.section_id === secId && t.time_slot_id === nextSlot.id
                                                                            )
                                                                        );
                                                                        if (hasNextSlot) { colSpan = 2; skipSlotIds.add(nextSlot.id); }
                                                                    }
                                                                }

                                                                if (allEntries.length === 0) {
                                                                    return <td key={slot.id} colSpan={colSpan} className="p-1" style={{ minWidth: `${120 * colSpan}px` }}></td>;
                                                                }

                                                                const cleanName = (name) => String(name || '').replace(/^(SEC|MDC|VAC|AEC|C|M|DSE|GE|CC|DSC)[-\s\d:]+/i, '').trim().toLowerCase();
                                                                const subjectMap = new Map();
                                                                allEntries.forEach(e => {
                                                                    const key = `${cleanName(e.subject_name || e.subject_code)}_${e.teacher_id}_${e.room_id}`;
                                                                    if (!subjectMap.has(key)) subjectMap.set(key, []);
                                                                    subjectMap.get(key).push(e);
                                                                });

                                                                const cards = Array.from(subjectMap.entries()).map(([subjectId, entries], cardIdx) => {
                                                                    const e0 = entries[0];
                                                                    const code = String(e0.subject_code || '').trim().toUpperCase();
                                                                    const name = String(e0.subject_name || '').trim().toLowerCase();
                                                                    const isLibrary = e0.isLibrary === true || code === 'LIB' || name === 'library period' || name === 'library';
                                                                    const isRem = isRemedialEntry(e0);
                                                                    const isSL = isSelfLearningEntry(e0);
                                                                    const colorStyle = isLibrary
                                                                        ? { bg: '#e8f4f8', border: '#90cce0', text: '#1a6b8a' }
                                                                        : isRem ? { bg: '#fff3e0', border: '#ffcc80', text: '#e65100' }
                                                                        : isSL ? { bg: '#e8f4f8', border: '#90cce0', text: '#1a6b8a' }
                                                                        : getSubjectColor(e0.subject_code);
                                                                    const isLab = !isLibrary && isLabByCredit(e0);
                                                                    const baseName = e0.subject_name || e0.subject_code;
                                                                    const shortName = getShortSubjectName(baseName);
                                                                    const displayName = isLibrary ? 'Library' : isRem ? 'REMEDIAL' : isSL ? 'Self Learning' : (isLab ? (String(shortName || '').toLowerCase().includes('lab') ? shortName : `${shortName} Lab`) : (e0.subject_code || e0.subject_name || ''));
                                                                    const isShared = entries.length === allSectionIds.length; // same subject for all merged sections

                                                                    // Collect unique rooms
                                                                    const rooms = [...new Set(entries.map(e => formatRoomName(e)).filter(Boolean))];

                                                                    const homeRooms = isMerged
                                                                        ? row.sections.map(s => formatRoomName(s)).filter(Boolean)
                                                                        : [formatRoomName(primarySec)].filter(Boolean);
                                                                    const isHomeRoom = rooms.length > 0 && rooms.every(r => homeRooms.includes(r));
                                                                    const shouldShowRoom = !isShared || !isHomeRoom;

                                                                    const tags = [];
                                                                    if (!isLibrary && Number(e0.is_online) === 1) tags.push('ONLINE');
                                                                    if (!isLibrary && isNptelSubject(e0)) tags.push('MOOC');
                                                                    const tagStr = tags.length > 0 ? ` {${tags.join(', ')}}` : '';

                                                                    return (
                                                                        <div key={cardIdx}
                                                                            className={`p-0 px-1 py-1 rounded ${cardIdx < subjectMap.size - 1 ? 'mb-1' : ''} d-flex flex-column justify-content-center position-relative`}
                                                                            style={{ backgroundColor: colorStyle.bg, border: `1px solid ${colorStyle.border}`, minHeight: '40px', overflow: 'hidden', opacity: e0.is_hidden ? 0.4 : 1 }}
                                                                            onMouseEnter={(e) => e.currentTarget.querySelector('.edit-btn')?.classList.remove('d-none')}
                                                                            onMouseLeave={(e) => e.currentTarget.querySelector('.edit-btn')?.classList.add('d-none')}
                                                                        >
                                                                            {e0.is_hidden === 1 || e0.is_hidden === true ? (
                                                                                <div className="position-absolute top-0 start-0 m-1">
                                                                                    <i className="bi bi-eye-slash-fill text-warning" title="Hidden from reports"></i>
                                                                                </div>
                                                                            ) : null}
                                                                            <button
                                                                                className="btn btn-sm btn-light border position-absolute top-0 end-0 m-1 edit-btn d-none"
                                                                                style={{ padding: '1px 4px', fontSize: '9px', zIndex: 10 }}
                                                                                onClick={() => {
                                                                                    setEditingEntries(entries);
                                                                                    setEditMeta({ day: day.name, time: `${slot.start_time} - ${slot.end_time}`, class: row.sections.map(s => s.section_name).join(', ') });
                                                                                    setShowManualEditModal(true);
                                                                                }}
                                                                                title="Edit Merged Slot"
                                                                            >
                                                                                <i className="bi bi-pencil-fill text-primary"></i>
                                                                            </button>
                                                                            <div className="fw-bold text-truncate" style={{ color: colorStyle.text, fontSize: '12px' }} title={baseName}>
                                                                                {displayName}
                                                                                {rooms.length > 0 && shouldShowRoom && !isLibrary && (
                                                                                    <span className="ms-1" style={{ fontSize: '12px' }}>
                                                                                        {isShared ? rooms.map((r, ri) => <React.Fragment key={ri}>{ri > 0 ? ', ' : ''}{renderRoomBadge(r)}</React.Fragment>) : rooms.map((r, ri) => <span key={ri} className="me-1">{renderRoomBadge(r)}</span>)}
                                                                                    </span>
                                                                                )}
                                                                                {tags.length > 0 && <span className="text-primary ms-1">{tagStr}</span>}
                                                                            </div>
                                                                            {(!isLibrary && !isSL) && (<div className="text-muted fw-bold text-truncate" style={{ fontSize: '13px' }} title={e0.teacher_name}>{isRem ? 'Class Teacher' : (isLab ? (e0.teacher_name || e0.teacher_short_name || 'N/A') : (e0.teacher_short_name || 'N/A'))}</div>)}
                                                                        </div>
                                                                    );
                                                                });


                                                                return (
                                                                    <td key={slot.id} colSpan={colSpan} className="p-1" style={{ minWidth: `${120 * colSpan}px` }}>
                                                                        {cards}
                                                                    </td>
                                                                );
                                                            })}
                                                            <td className="align-middle bg-light fw-medium" style={{ fontSize: '0.78rem' }}>{roomLabel.split(' / ').map((rl, idx) => <React.Fragment key={idx}>{idx > 0 ? ' / ' : ''}{rl.includes(' - ') ? renderRoomBadge(rl) : rl}</React.Fragment>)}</td>
                                                            <td className="align-middle bg-light text-muted small" style={{ fontSize: '0.78rem' }}>{strengthLabel}</td>
                                                        </tr>
                                                    );
                                                });
                                            })}
                                        </tbody>
                                    </table>
                                    {(() => {
                                        const nptelSubjects = Array.from(new Set(
                                            departmentTimetable
                                                .filter(t => t.is_nptel === 1)
                                                .map(t => `${t.subject_name} (${t.subject_code})`)
                                        ));
                                        if (nptelSubjects.length > 0) {
                                            return (
                                                <div className="mt-3 p-3 bg-danger bg-opacity-10 border border-danger border-opacity-25 rounded d-flex align-items-center gap-2">
                                                    <i className="bi bi-laptop text-danger fs-5"></i>
                                                    <div>
                                                        <span className="fw-bold text-danger">NPTEL / MOOC Online Course Note: </span>
                                                        <span className="small text-dark">
                                                            The following subjects are conducted via NPTEL/SWAYAM (MOOC) and are scheduled for 1 weekly interactive session: <strong>{nptelSubjects.join(', ')}</strong>.
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        }
                                        return null;
                                    })()}
                                </div>
                            );
                        })()}
                                </div>
                                {deptIndex < deptEntries.length - 1 && <hr className="my-0" style={{ borderTop: '3px solid var(--app-border-2)', opacity: 1 }} />}
                                </div>
                            );
                        })}
                    </div>
                );
            })()
            ) : (
                <div style={{
                    background: 'var(--app-surface)',
                    border: '1px solid var(--app-border)',
                    borderRadius: 'var(--radius-lg)',
                    boxShadow: 'var(--shadow-sm)',
                }}>
                    <div className="empty-state" style={{ padding: '60px 24px' }}>
                        <div className="empty-state-icon">
                            <i className="bi bi-grid-3x3-gap" />
                        </div>
                        <div className="empty-state-title">Select a Department & Section</div>
                        <p className="empty-state-text">Choose a session, department, and section above to view the allocations and generate timetables.</p>
                    </div>
                </div>
            )}
            <TeacherConstraintsModal
                show={showTeacherModal}
                onHide={() => setShowTeacherModal(false)}
                selectedDepartment={selectedDepartment}
            />

            <UnassignedWorkloadsModal
                show={showUnassignedModal}
                onHide={() => setShowUnassignedModal(false)}
                selectedDepartment={selectedDepartment}
                selectedSession={selectedSession}
            />

            <ManualEditModal
                show={showManualEditModal}
                onHide={() => setShowManualEditModal(false)}
                entries={editingEntries}
                meta={editMeta}
                onSuccess={fetchTimetable}
            />

            <TimetableHistoryModal
                show={showHistoryModal}
                onHide={() => setShowHistoryModal(false)}
                selectedSession={selectedSession}
                selectedDepartment={selectedDepartment}
                onViewHistory={(batchId) => setViewingHistoryBatch(batchId)}
            />
            <HiddenSlotsModal
                show={showHiddenModal}
                onHide={() => setShowHiddenModal(false)}
                hiddenSlots={(selectedSection ? timetable : departmentTimetable).filter(s => s.is_hidden === 1 || s.is_hidden === true)}
                onSuccess={fetchTimetable}
            />

            <GapAnalysisModal
                show={showGapAnalysisModal}
                onClose={() => setShowGapAnalysisModal(false)}
                sessionId={selectedSession}
                departmentId={selectedDepartment}
                departmentName={departments.find(d => d.id.toString() === selectedDepartment)?.name || ''}
            />
        </div>
    );
};

export default TimetableManager;
