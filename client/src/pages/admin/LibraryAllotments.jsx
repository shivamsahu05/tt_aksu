import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../utils/api';
import PageHeader from '../../components/common/PageHeader';
import DataTable from '../../components/common/DataTable';
import ActionButtons from '../../components/common/ActionButtons';
import FormModal from '../../components/common/FormModal';
import { toast } from 'react-toastify';
import Swal from 'sweetalert2';

const LibraryAllotments = () => {
    const { user } = useAuth();
    const isDepartmentAdmin = user?.role === 'DEPARTMENT_ADMIN';
    const deptId = user?.department_id;

    const [allotments, setAllotments] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [classes, setClasses] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [selectedSession, setSelectedSession] = useState('');
    
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    
    const [filterDepartment, setFilterDepartment] = useState('');
    const [page, setPage] = useState(1);

    const [formData, setFormData] = useState({
        id: '',
        session_id: '',
        department_id: '',
        class_ids: [],
        days: [],
        start_time: '',
        end_time: ''
    });

    const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    useEffect(() => {
        fetchInitialData();
    }, []);

    useEffect(() => {
        if (selectedSession) {
            fetchAllotments();
        }
    }, [selectedSession]);

    // Reset page on filter changes
    useEffect(() => {
        setPage(1);
    }, [filterDepartment, selectedSession]);

    const fetchInitialData = async () => {
        setLoading(true);
        try {
            const [deptRes, classRes, sessionRes] = await Promise.all([
                api.get('/departments?limit=100'),
                api.get('/classes?limit=1000'),
                api.get('/sessions')
            ]);
            setDepartments(deptRes.data.data || deptRes.data);
            setClasses(classRes.data.data || classRes.data);
            
            const fetchedSessions = sessionRes.data.data || sessionRes.data;
            setSessions(fetchedSessions);
            const activeSession = fetchedSessions.find(s => s.is_active);
            if (activeSession) setSelectedSession(activeSession.id);
            else if (fetchedSessions.length > 0) setSelectedSession(fetchedSessions[0].id);
        } catch (error) {
            toast.error('Failed to load initial data');
        } finally {
            setLoading(false);
        }
    };

    const fetchAllotments = async () => {
        setLoading(true);
        try {
            const res = await api.get(`/library-allotments?session_id=${selectedSession}`);
            setAllotments(res.data);
        } catch (error) {
            toast.error('Failed to load library allotments');
        } finally {
            setLoading(false);
        }
    };

    const handleOpenModal = () => {
        setIsEditMode(false);
        setFormData({
            id: '',
            session_id: selectedSession,
            department_id: isDepartmentAdmin ? deptId : '',
            class_ids: [],
            days: [],
            start_time: '',
            end_time: ''
        });
        setModalOpen(true);
    };

    const handleEdit = (row) => {
        setIsEditMode(true);
        setFormData({
            id: row.id,
            session_id: row.session_id,
            department_id: row.department_id,
            class_ids: (row.class_ids || '').split(',').map(Number),
            days: (row.days || '').split(','),
            start_time: row.start_time || '',
            end_time: row.end_time || ''
        });
        setModalOpen(true);
    };

    const handleDelete = async (id) => {
        const result = await Swal.fire({
            title: 'Delete Allotment?',
            text: "This action cannot be undone.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc3545',
            cancelButtonColor: '#6c757d',
            confirmButtonText: 'Yes, delete it!'
        });

        if (result.isConfirmed) {
            try {
                await api.delete(`/library-allotments/${id}`);
                toast.success('Library allotment deleted');
                fetchAllotments();
            } catch (error) {
                toast.error('Error deleting allotment');
            }
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (formData.class_ids.length === 0) {
            return toast.error('Please select at least one class');
        }
        if (formData.days.length === 0) {
            return toast.error('Please select at least one day');
        }

        try {
            const payload = {
                session_id: formData.session_id,
                department_id: formData.department_id,
                class_ids: formData.class_ids,
                days: formData.days,
                start_time: formData.start_time || null,
                end_time: formData.end_time || null
            };

            if (isEditMode) {
                await api.put(`/library-allotments/${formData.id}`, payload);
                toast.success('Allotment updated successfully');
            } else {
                await api.post('/library-allotments', payload);
                toast.success('Allotment scheduled successfully');
            }
            setModalOpen(false);
            fetchAllotments();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Error saving allotment');
        }
    };

    // Filter allotments
    let displayData = allotments;
    if (filterDepartment) {
        displayData = displayData.filter(a => a.department_id === parseInt(filterDepartment));
    }

    const totalPages = Math.ceil(displayData.length / 10);
    const paginatedData = displayData.slice((page - 1) * 10, page * 10);

    const getDayOfWeek = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { weekday: 'short' });
    };

    const columns = [
        {
            header: 'Department', 
            accessor: (row) => row.department_name || '-',
            headerStyle: { minWidth: '120px' }
        },
        { 
            header: 'Class', 
            accessor: (row) => row.classes_display || '-',
            headerStyle: { minWidth: '200px' }
        },
        {
            header: 'Days',
            accessor: (row) => row.days || '-',
            headerStyle: { minWidth: '120px' }
        },
        { 
            header: 'Timing', 
            accessor: (row) => {
                if (row.start_time && row.end_time) {
                    return `${row.start_time.substring(0, 5)} - ${row.end_time.substring(0, 5)}`;
                }
                return <span className="text-muted fst-italic">All Day</span>;
            },
            headerStyle: { minWidth: '120px' }
        },
        {
            header: 'Actions',
            accessor: (row) => (
                <ActionButtons
                    onEdit={() => handleEdit(row)}
                    onDelete={() => handleDelete(row.id)}
                />
            )
        }
    ];

    const currentDeptId = formData.department_id || (isDepartmentAdmin ? deptId : '');
    const filteredClasses = classes.filter(c => 
        c.is_active === 1 && 
        c.session_id === parseInt(formData.session_id || selectedSession || 0) &&
        (currentDeptId ? c.department_id === parseInt(currentDeptId) : true)
    );

    return (
        <div className="container-fluid py-4">
            <PageHeader
                title="Library Schedule"
                subtitle="Assign library sessions to departments and classes"
                actionButton={{
                    label: "Schedule Session",
                    icon: "bi-plus-lg",
                    onClick: handleOpenModal
                }}
            />

            <div className="d-flex justify-content-between align-items-center mb-4 mt-2">
                <div className="d-flex align-items-center gap-2">
                    <label className="form-label mb-0 fw-semibold">Academic Session:</label>
                    <select
                        className="form-select form-select-sm w-auto"
                        value={selectedSession}
                        onChange={(e) => setSelectedSession(e.target.value)}
                    >
                        {sessions.map(s => (
                            <option key={s.id} value={s.id}>{s.name} {s.is_active ? '(Active)' : ''}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="card shadow-sm border-0">
                <div className="card-header bg-white border-bottom pb-0 pt-3">
                    <div className="row align-items-center mb-3">
                        <div className="col-md-6">
                            <h5 className="mb-0 text-primary">Library Allotments</h5>
                        </div>
                        <div className="col-md-4 offset-md-2">
                            {!isDepartmentAdmin && (
                                <select
                                    className="form-select form-select-sm"
                                    value={filterDepartment}
                                    onChange={(e) => setFilterDepartment(e.target.value)}
                                >
                                    <option value="">All Departments</option>
                                    {departments.map(d => (
                                        <option key={d.id} value={d.id}>{d.name}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                    </div>
                </div>
                
                <DataTable
                    columns={columns}
                    data={paginatedData}
                    loading={loading}
                    emptyMessage="No library allotments found for the selected session."
                    searchable={true}
                    exportable={true}
                    exportFilename="Library_Schedules"
                    page={page}
                    totalPages={totalPages}
                    totalRows={displayData.length}
                    setPage={setPage}
                    rowClassName={() => 'table-light'}
                />
            </div>

            <FormModal
                show={modalOpen}
                onClose={() => setModalOpen(false)}
                title={isEditMode ? "Edit Library Session" : "Schedule Library Session"}
                onSubmit={handleSubmit}
                submitLabel={isEditMode ? "Save Changes" : "Schedule Session"}
                size="lg"
            >
                <div className="row">
                    {!isDepartmentAdmin && (
                        <div className="col-md-12 mb-3">
                            <label className="form-label">Department <span className="text-danger">*</span></label>
                            <select
                                className="form-select"
                                value={formData.department_id}
                                onChange={(e) => setFormData({ ...formData, department_id: e.target.value, class_ids: [] })}
                                required
                            >
                                <option value="">Select Department...</option>
                                {departments.map(d => (
                                    <option key={d.id} value={d.id}>{d.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="col-md-12 mb-3">
                        <label className="form-label">Classes <span className="text-danger">*</span></label>
                        <div className="border rounded p-2" style={{ maxHeight: '150px', overflowY: 'auto' }}>
                            {filteredClasses.length === 0 ? (
                                <div className="text-muted small p-2">No classes available</div>
                            ) : (
                                filteredClasses.map(c => (
                                    <div className="form-check" key={c.id}>
                                        <input
                                            className="form-check-input"
                                            type="checkbox"
                                            id={`class_${c.id}`}
                                            checked={formData.class_ids.includes(c.id)}
                                            onChange={(e) => {
                                                const newIds = e.target.checked 
                                                    ? [...formData.class_ids, c.id]
                                                    : formData.class_ids.filter(id => id !== c.id);
                                                setFormData({ ...formData, class_ids: newIds });
                                            }}
                                        />
                                        <label className="form-check-label" htmlFor={`class_${c.id}`}>
                                            {c.semester} {c.program_name}
                                        </label>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="col-md-12 mb-3">
                        <label className="form-label">Days <span className="text-danger">*</span></label>
                        <div className="d-flex flex-wrap gap-3">
                            {DAYS_OF_WEEK.map(day => (
                                <div className="form-check" key={day}>
                                    <input
                                        className="form-check-input"
                                        type="checkbox"
                                        id={`day_${day}`}
                                        checked={formData.days.includes(day)}
                                        onChange={(e) => {
                                            const newDays = e.target.checked
                                                ? [...formData.days, day]
                                                : formData.days.filter(d => d !== day);
                                            setFormData({ ...formData, days: newDays });
                                        }}
                                    />
                                    <label className="form-check-label" htmlFor={`day_${day}`}>
                                        {day}
                                    </label>
                                </div>
                            ))}
                        </div>
                    </div>
                    
                    <div className="col-md-12">
                        <label className="form-label text-muted d-block mb-2">Specific Timing (Optional)</label>
                    </div>

                    <div className="col-md-6 mb-3">
                        <label className="form-label">Start Time</label>
                        <input
                            type="time"
                            className="form-control"
                            value={formData.start_time}
                            onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                        />
                    </div>
                    
                    <div className="col-md-6 mb-3">
                        <label className="form-label">End Time</label>
                        <input
                            type="time"
                            className="form-control"
                            value={formData.end_time}
                            onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                        />
                    </div>
                </div>
            </FormModal>
        </div>
    );
};

export default LibraryAllotments;
