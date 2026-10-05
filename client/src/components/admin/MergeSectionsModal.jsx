import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import { toast } from 'react-toastify';

const MergeSectionsModal = ({ show, onClose, initialDepartmentId = '' }) => {
    const [sections, setSections] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedIds, setSelectedIds] = useState([]);
    const [processing, setProcessing] = useState(false);

    const [selectedDeptFilter, setSelectedDeptFilter] = useState(initialDepartmentId);

    // Update filter if initial prop changes
    useEffect(() => {
        if (initialDepartmentId) {
            setSelectedDeptFilter(initialDepartmentId);
        }
    }, [initialDepartmentId]);

    useEffect(() => {
        if (show) {
            fetchSections();
        } else {
            setSelectedIds([]);
            setSelectedDeptFilter('');
        }
    }, [show]);

    const fetchSections = async () => {
        try {
            setLoading(true);
            const res = await api.get('/classes/all-sections');
            if (res.data.success) {
                setSections(res.data.data);
            }
        } catch (error) {
            toast.error('Failed to fetch sections');
        } finally {
            setLoading(false);
        }
    };

    const handleMerge = async () => {
        if (selectedIds.length < 2) {
            toast.warning('Select at least 2 sections to merge.');
            return;
        }
        try {
            setProcessing(true);
            const res = await api.post('/classes/merge-sections', { section_ids: selectedIds });
            if (res.data.success) {
                toast.success('Sections merged successfully');
                fetchSections();
                setSelectedIds([]);
            }
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to merge sections');
        } finally {
            setProcessing(false);
        }
    };

    const handleUnmerge = async (secId) => {
        try {
            setProcessing(true);
            const res = await api.post('/classes/unmerge-sections', { section_ids: [secId] });
            if (res.data.success) {
                toast.success('Section unmerged successfully');
                fetchSections();
            }
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to unmerge section');
        } finally {
            setProcessing(false);
        }
    };

    if (!show) return null;

    // Unique departments for filter
    const uniqueDepartments = Array.from(new Set(sections.map(s => s.department_id)))
        .map(id => sections.find(s => s.department_id === id))
        .filter(s => s && s.department_id)
        .map(s => ({ id: s.department_id, name: s.department_name, short_code: s.department_short_code }))
        .sort((a, b) => a.short_code.localeCompare(b.short_code));

    // Calculate section labels based on ALL sections
    const sectionCountMap = {};
    const sectionOrderMap = {};
    sections.forEach(sec => {
        const key = `${sec.program_name}__${sec.semester}`;
        sectionCountMap[key] = (sectionCountMap[key] || 0) + 1;
        if (!sectionOrderMap[key]) sectionOrderMap[key] = [];
        sectionOrderMap[key].push(sec.id);
    });

    const getSectionLabel = (sec) => {
        const key = `${sec.program_name}__${sec.semester}`;
        if ((sectionCountMap[key] || 0) <= 1) {
            return null;
        } else {
            const letterMap = { 'A': 'B1', 'B': 'B2', 'C': 'B3', 'D': 'B4', 'E': 'B5', 'F': 'B6' };
            const mapped = letterMap[sec.section_name?.trim()?.toUpperCase()] || `B${(sectionOrderMap[key] || []).indexOf(sec.id) + 1}`;
            return `Sec: ${mapped}`;
        }
    };

    // Filter sections based on selected department
    const filteredSections = selectedDeptFilter 
        ? sections.filter(s => s.department_id === parseInt(selectedDeptFilter))
        : sections;

    // Group filtered sections
    const mergedGroups = {};
    const singleSections = [];
    
    filteredSections.forEach(sec => {
        if (sec.merge_group_id) {
            if (!mergedGroups[sec.merge_group_id]) mergedGroups[sec.merge_group_id] = [];
            mergedGroups[sec.merge_group_id].push(sec);
        } else {
            singleSections.push(sec);
        }
    });

    return (
        <div className="modal fade show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex="-1">
            <div className="modal-dialog modal-xl modal-dialog-scrollable">
                <div className="modal-content border-0 shadow-lg">
                    <div className="modal-header bg-light d-flex justify-content-between align-items-center">
                        <h5 className="modal-title fw-bold m-0 d-flex align-items-center gap-2">
                            <i className="bi bi-diagram-2 text-primary"></i> Manage Merged Sections
                        </h5>
                        <div className="d-flex align-items-center gap-3">
                            <select 
                                className="form-select form-select-sm rounded-pill px-3" 
                                style={{ width: '220px', minWidth: '150px' }}
                                value={selectedDeptFilter}
                                onChange={(e) => setSelectedDeptFilter(e.target.value)}
                            >
                                <option value="">All Departments</option>
                                {uniqueDepartments.map(dept => (
                                    <option key={dept.id} value={dept.id}>{dept.short_code || dept.name}</option>
                                ))}
                            </select>
                            <button type="button" className="btn-close" onClick={onClose} disabled={processing}></button>
                        </div>
                    </div>
                    <div className="modal-body p-4 bg-light">
                        {loading ? (
                            <div className="text-center py-5"><div className="spinner-border text-primary"></div></div>
                        ) : (
                            <div className="row g-4">
                                <div className="col-lg-6">
                                    <div className="card border-0 shadow-sm h-100">
                                        <div className="card-header bg-white border-bottom fw-bold py-3">
                                            Available Sections
                                            <div className="text-muted small fw-normal">Select sections to link together</div>
                                        </div>
                                        <div className="card-body p-0" style={{ maxHeight: '500px', overflowY: 'auto' }}>
                                            <ul className="list-group list-group-flush">
                                                {singleSections.map(sec => (
                                                    <label key={sec.id} className="list-group-item list-group-item-action d-flex align-items-center cursor-pointer py-3">
                                                        <input 
                                                            type="checkbox" 
                                                            className="form-check-input me-3"
                                                            checked={selectedIds.includes(sec.id)}
                                                            onChange={(e) => {
                                                                if (e.target.checked) setSelectedIds([...selectedIds, sec.id]);
                                                                else setSelectedIds(selectedIds.filter(id => id !== sec.id));
                                                            }}
                                                        />
                                                        <div className="w-100">
                                                            <div className="fw-bold text-dark">{sec.semester} {sec.program_name}</div>
                                                            <div className="d-flex align-items-center flex-wrap gap-2 mt-1">
                                                                {getSectionLabel(sec) && (
                                                                    <span className="badge bg-secondary bg-opacity-10 text-secondary border">
                                                                        {getSectionLabel(sec)}
                                                                    </span>
                                                                )}
                                                                <span className="badge bg-info bg-opacity-10 text-info border">
                                                                    <i className="bi bi-people-fill me-1"></i>
                                                                    Strength: {sec.student_strength || 0}
                                                                </span>
                                                                {(sec.department_short_code || sec.department_name) && (
                                                                    <span className="badge bg-light text-dark border">
                                                                        {sec.department_short_code || sec.department_name}
                                                                    </span>
                                                                )}
                                                                {sec.session_name && (
                                                                    <span className="badge bg-primary bg-opacity-10 text-primary border">
                                                                        Session: {sec.session_name}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </label>
                                                ))}
                                                {singleSections.length === 0 && (
                                                    <div className="p-4 text-center text-muted">No unmerged sections available.</div>
                                                )}
                                            </ul>
                                        </div>
                                        <div className="card-footer bg-white text-end py-3">
                                            <button className="btn btn-primary" onClick={handleMerge} disabled={selectedIds.length < 2 || processing}>
                                                {processing ? 'Processing...' : `Merge Selected (${selectedIds.length})`}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                
                                <div className="col-lg-6">
                                    <div className="card border-0 shadow-sm h-100">
                                        <div className="card-header bg-white border-bottom fw-bold py-3">
                                            Merged Groups
                                        </div>
                                        <div className="card-body bg-light" style={{ maxHeight: '500px', overflowY: 'auto' }}>
                                            {Object.entries(mergedGroups).length === 0 ? (
                                                <div className="text-center text-muted py-5">No merged groups.</div>
                                            ) : (
                                                <div className="d-flex flex-column gap-3">
                                                    {Object.entries(mergedGroups).map(([groupId, groupSecs], idx) => (
                                                        <div key={groupId} className="card border-0 shadow-sm">
                                                            <div className="card-header bg-primary bg-opacity-10 py-2 d-flex justify-content-between align-items-center">
                                                                <div>
                                                                    <span className="fw-bold text-primary me-2">
                                                                        <i className="bi bi-collection-fill me-1"></i>
                                                                        Merged Group #{idx + 1}
                                                                    </span>
                                                                    <span className="badge bg-primary text-white" style={{ fontSize: '11px' }}>
                                                                        {groupSecs.length} Sections
                                                                    </span>
                                                                </div>
                                                                <span className="text-muted small">
                                                                    Ref ID: {String(groupId).substring(0, 8)}
                                                                </span>
                                                            </div>
                                                            <ul className="list-group list-group-flush">
                                                                {groupSecs.map(sec => (
                                                                    <li key={sec.id} className="list-group-item d-flex justify-content-between align-items-center py-3">
                                                                        <div>
                                                                            <div className="fw-bold text-dark" style={{ fontSize: '0.95rem' }}>
                                                                                {sec.semester} {sec.program_name}
                                                                            </div>
                                                                            <div className="d-flex align-items-center flex-wrap gap-2 mt-1">
                                                                                {getSectionLabel(sec) && (
                                                                                    <span className="badge bg-secondary bg-opacity-10 text-secondary border">
                                                                                        {getSectionLabel(sec)}
                                                                                    </span>
                                                                                )}
                                                                                <span className="badge bg-info bg-opacity-10 text-info border">
                                                                                    <i className="bi bi-people-fill me-1"></i>
                                                                                    Strength: {sec.student_strength || 0}
                                                                                </span>
                                                                                {sec.session_name && (
                                                                                    <span className="badge bg-primary bg-opacity-10 text-primary border">
                                                                                        Session: {sec.session_name}
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                        <button className="btn btn-sm btn-outline-danger px-2 py-1 ms-2" style={{ fontSize: '12px', flexShrink: 0 }} onClick={() => handleUnmerge(sec.id)} disabled={processing}>
                                                                            Unlink
                                                                        </button>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MergeSectionsModal;
