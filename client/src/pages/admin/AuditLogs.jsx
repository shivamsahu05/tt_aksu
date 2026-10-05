import React, { useState, useEffect, useMemo } from 'react';
import api from '../../utils/api';
import PageHeader from '../../components/common/PageHeader';
import DataTable from '../../components/common/DataTable';
import { toast } from 'react-toastify';
import * as XLSX from 'xlsx';
import Swal from 'sweetalert2';

const AuditLogs = () => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);

    // Filtering states
    const [searchTerm, setSearchTerm] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [activePreset, setActivePreset] = useState('ALL'); // 'ALL', 'TODAY', 'LAST_7', 'MONTHLY'

    // Pagination states (Max 25 per page default as requested)
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(25);

    // Export Modal state
    const [showExportModal, setShowExportModal] = useState(false);
    const [exportScope, setExportScope] = useState('FILTERED'); // 'FILTERED', 'PAGE', 'ALL'
    const [exportFormat, setExportFormat] = useState('excel'); // 'excel' or 'csv'

    useEffect(() => {
        const fetchLogs = async () => {
            try {
                setLoading(true);
                // Fetch up to 5000 logs so full monthly & date range filtering is available
                const res = await api.get('/audit?limit=5000');
                if (res.data.success) {
                    setLogs(res.data.data);
                }
            } catch (error) {
                toast.error("Failed to load audit logs");
            } finally {
                setLoading(false);
            }
        };
        fetchLogs();
    }, []);

    // Handle preset quick filters (All Time, Today, Last 7 Days, This Month / Monthly)
    const handlePresetFilter = (preset) => {
        setActivePreset(preset);
        const now = new Date();
        if (preset === 'ALL') {
            setFromDate('');
            setToDate('');
        } else if (preset === 'TODAY') {
            const todayStr = now.toISOString().split('T')[0];
            setFromDate(todayStr);
            setToDate(todayStr);
        } else if (preset === 'LAST_7') {
            const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            setFromDate(lastWeek.toISOString().split('T')[0]);
            setToDate(now.toISOString().split('T')[0]);
        } else if (preset === 'MONTHLY') {
            // First day of current month to today
            const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
            setFromDate(firstDay.toISOString().split('T')[0]);
            setToDate(now.toISOString().split('T')[0]);
        }
        setCurrentPage(1);
    };

    // Filter logs by date range and search term
    const filteredLogs = useMemo(() => {
        return logs.filter(l => {
            // Date Filter
            const logDate = new Date(l.created_at);
            if (fromDate) {
                const start = new Date(fromDate + 'T00:00:00');
                if (logDate < start) return false;
            }
            if (toDate) {
                const end = new Date(toDate + 'T23:59:59');
                if (logDate > end) return false;
            }

            // Search Term Filter
            if (searchTerm.trim()) {
                const query = searchTerm.toLowerCase();
                const username = (l.username || 'system').toLowerCase();
                const action = (l.action || '').toLowerCase();
                const table = (l.table_name || '').toLowerCase();
                const details = (l.new_value || '').toLowerCase();
                return username.includes(query) || action.includes(query) || table.includes(query) || details.includes(query);
            }
            return true;
        });
    }, [logs, fromDate, toDate, searchTerm]);

    // Pagination calculations (Max 25 items per page)
    const totalPages = Math.max(1, Math.ceil(filteredLogs.length / itemsPerPage));
    const paginatedLogs = useMemo(() => {
        const startIdx = (currentPage - 1) * itemsPerPage;
        return filteredLogs.slice(startIdx, startIdx + itemsPerPage).map((log, idx) => ({
            ...log,
            s_no: startIdx + idx + 1
        }));
    }, [filteredLogs, currentPage, itemsPerPage]);

    // Reset current page when filter changes
    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(1);
        }
    }, [filteredLogs.length, totalPages]);

    // Export Handler
    const handleExport = () => {
        let sourceData = [];
        let label = '';
        if (exportScope === 'FILTERED') {
            sourceData = filteredLogs;
            label = `Filtered_Audit_Logs_${sourceData.length}_records`;
        } else if (exportScope === 'PAGE') {
            sourceData = paginatedLogs;
            label = `Page_${currentPage}_Audit_Logs_${sourceData.length}_records`;
        } else {
            sourceData = logs;
            label = `All_System_Audit_Logs_${sourceData.length}_records`;
        }

        if (sourceData.length === 0) {
            toast.warning('No records available to export.');
            return;
        }

        const formattedData = sourceData.map((l, idx) => ({
            'S.No': idx + 1,
            'Timestamp': new Date(l.created_at).toLocaleString(),
            'User Account': l.username || 'System',
            'Action Type': (l.action || '').replace(/_/g, ' ').toUpperCase(),
            'Module / Table': l.table_name || '-',
            'Record ID': l.record_id || '-',
            'Details & Changes': l.new_value ? JSON.stringify(JSON.parse(l.new_value)) : '-'
        }));

        const ws = XLSX.utils.json_to_sheet(formattedData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "AuditLogs");

        if (exportFormat === 'csv') {
            XLSX.writeFile(wb, `${label}.csv`);
        } else {
            XLSX.writeFile(wb, `${label}.xlsx`);
        }

        toast.success(`Successfully exported ${sourceData.length} audit log records!`);
        setShowExportModal(false);
    };

    const columns = [
        { 
            header: '#', 
            accessor: 's_no',
            cellClassName: 'text-muted small fw-bold',
            headerStyle: { width: '50px' }
        },
        { 
            header: 'Timestamp', 
            accessor: 'created_at',
            render: val => {
                const d = new Date(val);
                return (
                    <div>
                        <div className="fw-medium text-dark" style={{ fontSize: '13px' }}>
                            {d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </div>
                        <div className="text-muted" style={{ fontSize: '11px' }}>
                            {d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </div>
                    </div>
                );
            }
        },
        { 
            header: 'User Account', 
            accessor: 'username',
            render: val => (
                <div className="d-flex align-items-center gap-2">
                    <div className="bg-primary bg-opacity-10 text-primary rounded-circle d-flex align-items-center justify-content-center" style={{ width: '28px', height: '28px', fontSize: '12px', fontWeight: 600 }}>
                        {(val || 'S').charAt(0).toUpperCase()}
                    </div>
                    <span className="fw-semibold text-dark">{val || 'System'}</span>
                </div>
            )
        },
        { 
            header: 'Action', 
            accessor: 'action',
            render: val => {
                const clean = (val || '').replace(/_/g, ' ').toUpperCase();
                let badgeClass = 'bg-secondary bg-opacity-10 text-secondary';
                if (clean.includes('CREATE') || clean.includes('ADD')) badgeClass = 'bg-success bg-opacity-10 text-success border border-success border-opacity-25';
                else if (clean.includes('DELETE') || clean.includes('REMOVE')) badgeClass = 'bg-danger bg-opacity-10 text-danger border border-danger border-opacity-25';
                else if (clean.includes('UPDATE') || clean.includes('EDIT')) badgeClass = 'bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25';
                else if (clean.includes('LOGIN') || clean.includes('AUTH')) badgeClass = 'bg-info bg-opacity-10 text-info border border-info border-opacity-25';

                return <span className={`badge ${badgeClass} px-2 py-1 fw-medium`} style={{ fontSize: '11px' }}>{clean}</span>;
            }
        },
        { 
            header: 'Module', 
            accessor: 'table_name',
            render: val => (
                <span className="text-dark fw-medium" style={{ fontSize: '13px' }}>{val || '-'}</span>
            )
        },
        { 
            header: 'Record ID', 
            accessor: 'record_id', 
            render: val => val ? <span className="badge bg-light text-dark border">{val}</span> : '-'
        },
        { 
            header: 'Details', 
            accessor: 'new_value',
            render: val => val ? (
                <button 
                    className="btn btn-sm btn-outline-primary py-0 px-2 rounded-pill d-inline-flex align-items-center gap-1"
                    style={{ fontSize: '11.5px' }}
                    onClick={() => {
                        try {
                            const parsed = JSON.parse(val);
                            Swal.fire({
                                title: '<i class="bi bi-file-earmark-code me-2"></i>Audit Modification Details',
                                html: `<pre class="text-start bg-light p-3 rounded border text-dark shadow-inner" style="font-size: 13px; max-height: 400px; overflow-y: auto;"><code>${JSON.stringify(parsed, null, 2)}</code></pre>`,
                                width: '650px',
                                confirmButtonText: 'Close',
                                confirmButtonColor: '#3b82f6',
                                showCloseButton: true
                            });
                        } catch (e) {
                            Swal.fire({
                                title: 'Audit Details',
                                text: val,
                                confirmButtonColor: '#3b82f6'
                            });
                        }
                    }}
                >
                    <i className="bi bi-eye"></i> View Data
                </button>
            ) : <span className="text-muted">-</span>
        }
    ];

    return (
        <div className="page-content">
            <PageHeader 
                title="System Audit Logs" 
                subtitle="Track user access, timetable regenerations, and data modifications" 
                icon="bi-shield-lock" 
                actionButton={{
                    label: `Export (${filteredLogs.length})`,
                    icon: "bi-download",
                    onClick: () => setShowExportModal(true),
                    className: "btn-primary rounded-pill px-4 shadow-sm"
                }}
            />

            {/* Date Range & Quick Preset Filter Toolbar */}
            <div className="card border-0 shadow-sm rounded-3 mb-4">
                <div className="card-body p-3">
                    <div className="row g-3 align-items-center">
                        {/* Preset Buttons */}
                        <div className="col-12 col-xl-5">
                            <label className="form-label small text-muted fw-bold mb-1 d-block">
                                <i className="bi bi-funnel me-1"></i> Quick Date Filter Presets
                            </label>
                            <div className="d-flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    className={`btn btn-sm ${activePreset === 'ALL' ? 'btn-dark fw-bold' : 'btn-outline-secondary'}`}
                                    onClick={() => handlePresetFilter('ALL')}
                                >
                                    All Time
                                </button>
                                <button
                                    type="button"
                                    className={`btn btn-sm ${activePreset === 'TODAY' ? 'btn-primary fw-bold' : 'btn-outline-secondary'}`}
                                    onClick={() => handlePresetFilter('TODAY')}
                                >
                                    Today
                                </button>
                                <button
                                    type="button"
                                    className={`btn btn-sm ${activePreset === 'LAST_7' ? 'btn-primary fw-bold' : 'btn-outline-secondary'}`}
                                    onClick={() => handlePresetFilter('LAST_7')}
                                >
                                    Last 7 Days
                                </button>
                                <button
                                    type="button"
                                    className={`btn btn-sm ${activePreset === 'MONTHLY' ? 'btn-success fw-bold' : 'btn-outline-secondary'}`}
                                    onClick={() => handlePresetFilter('MONTHLY')}
                                >
                                    <i className="bi bi-calendar-month me-1"></i> This Month (Monthly)
                                </button>
                            </div>
                        </div>

                        {/* Custom Date Inputs (Kab se kab tak) */}
                        <div className="col-12 col-xl-5">
                            <label className="form-label small text-muted fw-bold mb-1 d-block">
                                <i className="bi bi-calendar-range me-1"></i> Custom Date Range (Kab se kab tak)
                            </label>
                            <div className="d-flex align-items-center gap-2">
                                <div className="input-group input-group-sm">
                                    <span className="input-group-text bg-light text-muted">From</span>
                                    <input 
                                        type="date" 
                                        className="form-control" 
                                        value={fromDate}
                                        onChange={(e) => {
                                            setFromDate(e.target.value);
                                            setActivePreset('CUSTOM');
                                            setCurrentPage(1);
                                        }} 
                                    />
                                </div>
                                <div className="input-group input-group-sm">
                                    <span className="input-group-text bg-light text-muted">To</span>
                                    <input 
                                        type="date" 
                                        className="form-control" 
                                        value={toDate}
                                        onChange={(e) => {
                                            setToDate(e.target.value);
                                            setActivePreset('CUSTOM');
                                            setCurrentPage(1);
                                        }} 
                                    />
                                </div>
                                {(fromDate || toDate) && (
                                    <button
                                        type="button"
                                        className="btn btn-sm btn-light border text-danger flex-shrink-0"
                                        onClick={() => handlePresetFilter('ALL')}
                                        title="Clear Date Filters"
                                    >
                                        <i className="bi bi-x-lg"></i>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Rows per page selector */}
                        <div className="col-12 col-xl-2 text-xl-end">
                            <label className="form-label small text-muted fw-bold mb-1 d-block">
                                Rows per Page
                            </label>
                            <select
                                className="form-select form-select-sm d-inline-block"
                                style={{ maxWidth: '140px' }}
                                value={itemsPerPage}
                                onChange={(e) => {
                                    setItemsPerPage(Number(e.target.value));
                                    setCurrentPage(1);
                                }}
                            >
                                <option value={25}>Max 25 (Default)</option>
                                <option value={50}>Max 50</option>
                                <option value={100}>Max 100</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* Filter status banner */}
            {(fromDate || toDate) && (
                <div className="alert alert-info py-2 px-3 mb-3 d-flex align-items-center justify-content-between rounded-3 border-0 bg-info bg-opacity-10">
                    <div className="small text-dark">
                        <i className="bi bi-info-circle-fill text-info me-2"></i>
                        Showing audit records 
                        {fromDate && <> from <b>{fromDate}</b></>}
                        {toDate && <> to <b>{toDate}</b></>}: 
                        <span className="fw-bold ms-1 text-primary">{filteredLogs.length} matching logs</span>
                    </div>
                    <button className="btn btn-sm btn-link py-0 text-decoration-none" onClick={() => handlePresetFilter('ALL')}>
                        Reset Date Filter
                    </button>
                </div>
            )}
            
            <DataTable 
                columns={columns} 
                data={paginatedLogs} 
                loading={loading} 
                searchTerm={searchTerm}
                onSearch={(val) => {
                    setSearchTerm(val);
                    setCurrentPage(1);
                }}
                searchPlaceholder="Search by user, action, module or details..."
                page={currentPage}
                totalPages={totalPages}
                totalRows={filteredLogs.length}
                setPage={setCurrentPage}
            />

            {/* Interactive Export Options Modal */}
            {showExportModal && (
                <div className="modal fade show d-block" style={{ background: 'rgba(0,0,0,0.5)', zIndex: 1055 }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content rounded-4 border-0 shadow-lg">
                            <div className="modal-header bg-light border-bottom">
                                <h5 className="modal-title fw-bold">
                                    <i className="bi bi-download text-primary me-2"></i> Export Audit Logs
                                </h5>
                                <button type="button" className="btn-close" onClick={() => setShowExportModal(false)}></button>
                            </div>
                            <div className="modal-body p-4">
                                <p className="text-muted small mb-3">
                                    Choose which data you want to export and select the file format.
                                </p>

                                {/* Scope Selection */}
                                <div className="mb-4">
                                    <label className="form-label fw-bold small text-dark">1. Select Data to Export (Kitne data export karna hai)</label>
                                    <div className="d-flex flex-column gap-2">
                                        <label className={`card p-3 border cursor-pointer ${exportScope === 'FILTERED' ? 'border-primary bg-primary bg-opacity-10' : 'bg-light'}`} style={{ cursor: 'pointer' }}>
                                            <div className="form-check mb-0">
                                                <input 
                                                    className="form-check-input" 
                                                    type="radio" 
                                                    name="exportScope" 
                                                    checked={exportScope === 'FILTERED'} 
                                                    onChange={() => setExportScope('FILTERED')} 
                                                />
                                                <span className="fw-bold text-dark ms-1">Current Filtered Range ({filteredLogs.length} records)</span>
                                                <div className="small text-muted ms-4">
                                                    Exports logs matching your current date range ({fromDate || 'Earliest'} to {toDate || 'Now'}) and search filter.
                                                </div>
                                            </div>
                                        </label>

                                        <label className={`card p-3 border cursor-pointer ${exportScope === 'PAGE' ? 'border-primary bg-primary bg-opacity-10' : 'bg-light'}`} style={{ cursor: 'pointer' }}>
                                            <div className="form-check mb-0">
                                                <input 
                                                    className="form-check-input" 
                                                    type="radio" 
                                                    name="exportScope" 
                                                    checked={exportScope === 'PAGE'} 
                                                    onChange={() => setExportScope('PAGE')} 
                                                />
                                                <span className="fw-bold text-dark ms-1">Current Page Only ({paginatedLogs.length} records)</span>
                                                <div className="small text-muted ms-4">
                                                    Exports only the {itemsPerPage} logs currently visible on Page {currentPage}.
                                                </div>
                                            </div>
                                        </label>

                                        <label className={`card p-3 border cursor-pointer ${exportScope === 'ALL' ? 'border-primary bg-primary bg-opacity-10' : 'bg-light'}`} style={{ cursor: 'pointer' }}>
                                            <div className="form-check mb-0">
                                                <input 
                                                    className="form-check-input" 
                                                    type="radio" 
                                                    name="exportScope" 
                                                    checked={exportScope === 'ALL'} 
                                                    onChange={() => setExportScope('ALL')} 
                                                />
                                                <span className="fw-bold text-dark ms-1">All Audit History ({logs.length} records)</span>
                                                <div className="small text-muted ms-4">
                                                    Exports all system logs from the entire database history.
                                                </div>
                                            </div>
                                        </label>
                                    </div>
                                </div>

                                {/* Format Selection */}
                                <div>
                                    <label className="form-label fw-bold small text-dark">2. File Format</label>
                                    <div className="d-flex gap-3">
                                        <label className="form-check">
                                            <input 
                                                className="form-check-input" 
                                                type="radio" 
                                                name="exportFormat" 
                                                checked={exportFormat === 'excel'} 
                                                onChange={() => setExportFormat('excel')} 
                                            />
                                            <span className="form-check-label fw-medium"><i className="bi bi-file-earmark-excel text-success me-1"></i> Excel (.xlsx)</span>
                                        </label>
                                        <label className="form-check">
                                            <input 
                                                className="form-check-input" 
                                                type="radio" 
                                                name="exportFormat" 
                                                checked={exportFormat === 'csv'} 
                                                onChange={() => setExportFormat('csv')} 
                                            />
                                            <span className="form-check-label fw-medium"><i className="bi bi-filetype-csv text-info me-1"></i> CSV (.csv)</span>
                                        </label>
                                    </div>
                                </div>
                            </div>
                            <div className="modal-footer bg-light border-top">
                                <button type="button" className="btn btn-light" onClick={() => setShowExportModal(false)}>
                                    Cancel
                                </button>
                                <button type="button" className="btn btn-primary px-4 fw-semibold shadow-sm" onClick={handleExport}>
                                    <i className="bi bi-download me-2"></i> Download Export
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AuditLogs;

