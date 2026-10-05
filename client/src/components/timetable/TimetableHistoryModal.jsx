import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import { toast } from 'react-toastify';

const TimetableHistoryModal = ({ show, onHide, selectedSession, selectedDepartment, onViewHistory }) => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    
    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 20;

    useEffect(() => {
        if (show && selectedSession && selectedDepartment) {
            fetchHistory();
        }
    }, [show, selectedSession, selectedDepartment]);

    const fetchHistory = async () => {
        setLoading(true);
        try {
            const timestamp = Date.now();
            const res = await api.get(`/timetable/history?session_id=${selectedSession}&department_id=${selectedDepartment}&_t=${timestamp}`);
            if (res.data.success) {
                setHistory(res.data.data);
                setCurrentPage(1); // Reset to page 1 on new fetch
            }
        } catch (error) {
            toast.error('Failed to load timetable history');
        } finally {
            setLoading(false);
        }
    };

    if (!show) return null;

    const totalPages = Math.ceil(history.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedHistory = history.slice(startIndex, startIndex + itemsPerPage);

    return (
        <div className="modal fade show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex="-1">
            <div className="modal-dialog modal-lg modal-dialog-centered">
                <div className="modal-content shadow">
                    <div className="modal-header border-bottom-0 bg-light">
                        <h5 className="modal-title fw-bold text-dark">Timetable Generation History</h5>
                        <button type="button" className="btn-close" onClick={onHide}></button>
                    </div>
                    <div className="modal-body p-4">
                        {loading ? (
                            <div className="text-center py-5">
                                <div className="spinner-border text-primary" role="status">
                                    <span className="visually-hidden">Loading...</span>
                                </div>
                                <p className="mt-2 text-muted">Loading history...</p>
                            </div>
                        ) : history.length === 0 ? (
                            <div className="text-center py-5 text-muted">
                                No generated timetables found in history.
                            </div>
                        ) : (
                            <div>
                                <div className="table-responsive">
                                    <table className="table table-hover align-middle">
                                        <thead className="table-light">
                                            <tr>
                                                <th>#</th>
                                                <th>Generation Date & Time</th>
                                                <th>Status</th>
                                                <th>Entries Generated</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {paginatedHistory.map((record, index) => (
                                                <tr key={record.batch_id}>
                                                    <td>{startIndex + index + 1}</td>
                                                    <td className="fw-bold">
                                                        {new Date(record.created_at).toLocaleString('en-IN', {
                                                            timeZone: 'Asia/Kolkata',
                                                            day: '2-digit',
                                                            month: 'short',
                                                            year: 'numeric',
                                                            hour: '2-digit',
                                                            minute: '2-digit',
                                                            hour12: true
                                                        }).toUpperCase()}
                                                    </td>
                                                    <td>
                                                        {record.status === 'active' ? (
                                                            <span className="badge bg-success">Active</span>
                                                        ) : record.status === 'archived' ? (
                                                            <span className="badge bg-secondary">Archived</span>
                                                        ) : (
                                                            <span className="badge bg-dark">{record.status}</span>
                                                        )}
                                                    </td>
                                                    <td>{record.entry_count} slots</td>
                                                    <td>
                                                        <button 
                                                            className="btn btn-outline-primary btn-sm"
                                                            onClick={() => {
                                                                onViewHistory(record.batch_id, record.created_at);
                                                                onHide();
                                                            }}
                                                        >
                                                            <i className="bi bi-eye-fill me-1"></i> View Grid
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                {totalPages > 1 && (
                                    <div className="d-flex justify-content-between align-items-center mt-3">
                                        <span className="text-muted small">
                                            Showing {startIndex + 1} to {Math.min(startIndex + itemsPerPage, history.length)} of {history.length} entries
                                        </span>
                                        <nav>
                                            <ul className="pagination pagination-sm mb-0">
                                                <li className={`page-item ${currentPage === 1 ? 'disabled' : ''}`}>
                                                    <button className="page-link" onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}>Previous</button>
                                                </li>
                                                {[...Array(totalPages)].map((_, i) => (
                                                    <li key={i + 1} className={`page-item ${currentPage === i + 1 ? 'active' : ''}`}>
                                                        <button className="page-link" onClick={() => setCurrentPage(i + 1)}>{i + 1}</button>
                                                    </li>
                                                ))}
                                                <li className={`page-item ${currentPage === totalPages ? 'disabled' : ''}`}>
                                                    <button className="page-link" onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}>Next</button>
                                                </li>
                                            </ul>
                                        </nav>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="modal-footer border-top-0 bg-light">
                        <button type="button" className="btn btn-secondary" onClick={onHide}>Close</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TimetableHistoryModal;
