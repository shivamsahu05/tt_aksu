import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../utils/api';
import { toast } from 'react-toastify';
import { safeDelete, showSuccess } from '../../utils/alerts';
import FormModal from '../../components/common/FormModal';
import PageHeader from '../../components/common/PageHeader';
import DataTable from '../../components/common/DataTable';
import ActionButtons from '../../components/common/ActionButtons';
import { useForm } from 'react-hook-form';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';

const Rooms = () => {
    const { user } = useAuth();
    const isDeptAdmin = ['DEPARTMENT_ADMIN', 'FACULTY'].includes(user?.role);
    const [rooms, setRooms] = useState([]);
    const [roomStats, setRoomStats] = useState({ theory: 0, lab: 0 });
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [buildingFilter, setBuildingFilter] = useState('');
    const [deptFilter, setDeptFilter] = useState(isDeptAdmin ? user.department_id : '');
    const [floorFilter, setFloorFilter] = useState('');
    const [buildings, setBuildings] = useState([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalRows, setTotalRows] = useState(0);
    const [showModal, setShowModal] = useState(false);
    const [editItem, setEditItem] = useState(null);

    // Bulk Upload state
    const [showBulkUpload, setShowBulkUpload] = useState(false);
    const [bulkFile, setBulkFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [bulkErrors, setBulkErrors] = useState(null);
    const [bulkSummary, setBulkSummary] = useState(null);

    const [departments, setDepartments] = useState([]);

    const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm();

    const fetchBuildings = async () => {
        try {
            const res = await api.get('/rooms/buildings');
            if (res.data.success) setBuildings(res.data.data);
        } catch (error) {
            console.error('Failed to fetch buildings');
        }
    };

    const fetchDepartments = async () => {
        try {
            const res = await api.get('/departments?limit=100');
            if (res.data.success) setDepartments(res.data.data);
        } catch (error) {
            console.error('Failed to fetch departments');
        }
    };

    const fetchRooms = async () => {
        try {
            setLoading(true);
            let url = `/rooms?page=${page}&limit=50&search=${searchTerm}`;
            if (buildingFilter) url += `&building=${encodeURIComponent(buildingFilter)}`;
            if (deptFilter) url += `&department=${deptFilter}`;
            if (floorFilter) url += `&floor=${floorFilter}`;
            const res = await api.get(url);
            if (res.data.success) {
                setRooms(res.data.data);
                if (res.data.stats) setRoomStats(res.data.stats);
                setTotalPages(res.data.pagination.totalPages);
                setTotalRows(res.data.pagination.totalRows);
            }
        } catch (error) {
            toast.error('Failed to fetch rooms');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { 
        fetchBuildings();
        fetchDepartments();
    }, []);

    useEffect(() => { fetchRooms(); }, [page, searchTerm, buildingFilter, floorFilter, deptFilter]);

    const handleSearch = (val) => { setSearchTerm(val); setPage(1); };
    const handleBuildingFilter = (e) => { setBuildingFilter(e.target.value); setPage(1); };
    const handleFloorFilter = (e) => { setFloorFilter(e.target.value); setPage(1); };

    const openAddModal = () => {
        setEditItem(null);
        reset({ room_number: '', building: '', capacity: 30, is_lab: false, is_active: true, is_smart_room: false, department_id: isDeptAdmin ? user.department_id : '' });
        setShowModal(true);
    };

    const openEditModal = (room) => {
        setEditItem(room);
        reset({
            room_number: room.room_number,
            building: room.building || '',
            capacity: room.capacity,
            is_lab: room.is_lab === 1,
            is_smart_room: room.is_smart_room === 1,
            is_active: room.is_active === 1,
            department_id: room.department_id || ''
        });
        setShowModal(true);
    };

    const onSubmit = async (data) => {
        try {
            const payload = { 
                ...data, 
                capacity: parseInt(data.capacity), 
                is_lab: data.is_lab ? 1 : 0, 
                is_smart_room: data.is_smart_room ? 1 : 0,
                is_active: data.is_active ? 1 : 0 
            };
            if (editItem) {
                await api.put(`/rooms/${editItem.id}`, payload);
                showSuccess('Room updated');
            } else {
                await api.post('/rooms', payload);
                showSuccess('Room added');
            }
            setShowModal(false);
            fetchRooms();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Operation failed');
        }
    };

    const handleDelete = (id, number) => {
        safeDelete(`Room ${number}`, async () => {
            try {
                await api.delete(`/rooms/${id}`);
                showSuccess('Room deleted');
                fetchRooms();
            } catch (error) {
                toast.error(error.response?.data?.message || 'Failed to delete');
            }
        });
    };

    const handleDownloadTemplate = () => {
        const headers = ["Room Number", "Building", "Capacity", "Type", "Department Code"];
        const data = [
            ["101", "Main Block", 60, "theory", "CSE"],
            ["Lab-1", "Main Block", 30, "lab", "CSE"],
            ["201", "Main Block", 60, "both", "Shared"],
            ["301", "Main Block", 60, "theory", ""]
        ];

        const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
        ws['!cols'] = [
            { wch: 15 }, // Room Number
            { wch: 20 }, // Building
            { wch: 12 }, // Capacity
            { wch: 15 }, // Type
            { wch: 20 }  // Department Code
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Rooms");
        XLSX.writeFile(wb, "room_upload_template.csv");
    };

    const handleBulkUpload = async (e) => {
        e.preventDefault();
        if (!bulkFile) {
            toast.warning('Please select a CSV file');
            return;
        }

        const formData = new FormData();
        formData.append('file', bulkFile);

        try {
            setIsUploading(true);
            setBulkErrors(null);
            setBulkSummary(null);
            const res = await api.post('/rooms/bulk', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            
            if (res.data.success) {
                setBulkSummary(res.data.summary);
                if (res.data.errors && res.data.errors.length > 0) {
                    setBulkErrors(res.data.errors);
                    toast.warning(`Upload complete with some errors.`);
                } else {
                    toast.success(res.data.message);
                    setShowBulkUpload(false);
                }
                fetchRooms();
            }
        } catch (error) {
            setBulkErrors([error.response?.data?.message || 'Server error during upload']);
        } finally {
            setIsUploading(false);
        }
    };

    const handleDeleteByDepartment = async () => {
        const deptOptions = [
            `<div class="form-check text-start mb-2 border-bottom pb-2">
                <input class="form-check-input dept-check" type="checkbox" value="null" id="dept-shared">
                <label class="form-check-label small fw-bold text-primary" for="dept-shared"><i class="bi bi-diagram-3-fill me-1"></i>Shared Rooms <span class="text-muted fw-normal">(No specific department)</span></label>
            </div>`,
            ...departments.map(d =>
                `<div class="form-check text-start mb-1">
                    <input class="form-check-input dept-check" type="checkbox" value="${d.id}" id="dept-${d.id}">
                    <label class="form-check-label small" for="dept-${d.id}">${d.name} <span class="text-muted">(${d.short_code})</span></label>
                </div>`
            )
        ].join('');

        const { isConfirmed, value: selectedIds } = await Swal.fire({
            title: '<span style="color:#dc3545"><i class="bi bi-trash3-fill me-2"></i>Delete Rooms by Department</span>',
            html: `
                <p class="text-muted small mb-3">Select one or more departments. <strong>All rooms</strong> assigned to those departments will be permanently deleted.</p>
                <div style="max-height:260px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;text-align:left">
                    ${deptOptions}
                </div>
                <div class="mt-2 text-start">
                    <button type="button" class="btn btn-sm btn-link text-muted p-0" onclick="document.querySelectorAll('.dept-check').forEach(c=>c.checked=true)">Select All</button>
                    &nbsp;|&nbsp;
                    <button type="button" class="btn btn-sm btn-link text-muted p-0" onclick="document.querySelectorAll('.dept-check').forEach(c=>c.checked=false)">Deselect All</button>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: '<i class="bi bi-trash3-fill me-1"></i> Delete Selected',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#dc3545',
            cancelButtonColor: '#64748b',
            focusConfirm: false,
            preConfirm: () => {
                const checked = [...document.querySelectorAll('.dept-check:checked')].map(c => c.value === 'null' ? 'null' : parseInt(c.value));
                if (checked.length === 0) {
                    Swal.showValidationMessage('Please select at least one department.');
                    return false;
                }
                return checked;
            }
        });

        if (!isConfirmed || !selectedIds) return;

        const selectedNames = [
            ...(selectedIds.includes('null') ? ['Shared Rooms'] : []),
            ...departments.filter(d => selectedIds.includes(d.id)).map(d => d.name)
        ].join(', ');

        const { isConfirmed: finalConfirm } = await Swal.fire({
            title: 'Are you absolutely sure?',
            html: `<p class="mb-2">This will <strong>permanently delete ALL rooms</strong> from:</p><p class="fw-bold text-danger">${selectedNames}</p><p class="text-muted small">This action <strong>cannot be undone</strong>.</p>`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Yes, Delete Permanently',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#dc3545',
            cancelButtonColor: '#64748b',
        });

        if (!finalConfirm) return;

        try {
            const res = await api.post('/rooms/bulk-delete', { department_ids: selectedIds });
            if (res.data.success) {
                Swal.fire('Deleted!', res.data.message, 'success');
                fetchRooms();
            }
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to delete rooms');
        }
    };

    const columns = [
        { label: 'Room', headerStyle: { paddingLeft: '16px' } },
        { label: 'Building' },
        { label: 'Department' },
        { label: 'Type', headerStyle: { width: '110px' } },
        { label: 'Smart', headerStyle: { width: '90px' } },
        { label: 'Capacity', headerStyle: { width: '110px' } },
        { label: 'Status', headerStyle: { width: '100px' } },
        { label: 'Actions', headerStyle: { width: '100px', textAlign: 'right' } },
    ];

    return (
        <div>
            <PageHeader
                title="Rooms & Labs"
                subtitle="Manage classrooms, laboratories, and other campus facilities"
                icon="bi-building"
                actionButton={{ label: 'Add Room', icon: 'bi-plus-lg', onClick: openAddModal }}
            />

            <div className="alert alert-primary d-flex align-items-center shadow-sm border-0 mb-4 rounded-3" role="alert">
                <i className="bi bi-info-circle-fill text-primary fs-4 me-3"></i>
                <div>
                    <strong className="d-block mb-1">Important Note regarding Shared Rooms:</strong>
                    <span className="small">Shared rooms can accommodate a maximum of 2 classes (one from the primary department and one from another department). Once 2 classes are allotted, the room will be marked as FULL and cannot be allocated further.</span>
                </div>
            </div>

            <div className="d-flex flex-wrap justify-content-start justify-content-sm-end mb-3 px-2 gap-2">
                <button onClick={handleDeleteByDepartment} className="btn btn-sm btn-outline-danger rounded-pill shadow-sm d-inline-flex align-items-center justify-content-center text-nowrap">
                    <i className="bi bi-trash3-fill me-1"></i>
                    <span className="d-none d-sm-inline">Delete by Department</span>
                    <span className="d-sm-none">Delete</span>
                </button>
                <button onClick={() => { setBulkFile(null); setBulkErrors(null); setBulkSummary(null); setShowBulkUpload(true); }} className="btn btn-sm btn-primary rounded-pill shadow-sm d-inline-flex align-items-center justify-content-center text-nowrap">
                    <i className="bi bi-cloud-upload me-1"></i>
                    <span className="d-none d-sm-inline">Bulk Upload Rooms</span>
                    <span className="d-sm-none">Bulk Upload</span>
                </button>
            </div>

            {/* ── Room Stats Overview ── */}
            {roomStats && (
                <div style={{ marginBottom: '24px' }}>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                        gap: '12px',
                    }}>
                        {[{
                            icon: 'bi-building-fill', label: 'Total Rooms',
                            value: roomStats.total,
                            gradient: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', shadow: 'rgba(99,102,241,0.3)'
                        }, {
                            icon: 'bi-easel2', label: 'Theory Rooms',
                            value: roomStats.theory,
                            gradient: 'linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)', shadow: 'rgba(14,165,233,0.3)'
                        }, {
                            icon: 'bi-pc-display', label: 'Lab Rooms',
                            value: roomStats.lab,
                            gradient: 'linear-gradient(135deg, #14b8a6 0%, #2dd4bf 100%)', shadow: 'rgba(20,184,166,0.3)'
                        }, {
                            icon: 'bi-door-closed-fill', label: 'Assigned',
                            value: roomStats.assigned,
                            gradient: 'linear-gradient(135deg, #22c55e 0%, #4ade80 100%)', shadow: 'rgba(34,197,94,0.3)'
                        }, {
                            icon: 'bi-door-open-fill', label: 'Unassigned',
                            value: roomStats.unassigned,
                            gradient: roomStats.unassigned > 0
                                ? 'linear-gradient(135deg, #f97316 0%, #fb923c 100%)'
                                : 'linear-gradient(135deg, #94a3b8 0%, #cbd5e1 100%)',
                            shadow: roomStats.unassigned > 0
                                ? 'rgba(249,115,22,0.3)'
                                : 'rgba(148,163,184,0.3)'
                        }].map((stat, i) => (
                            <div key={i} className="hover-lift" style={{
                                background: 'var(--app-surface, #fff)',
                                border: '1px solid var(--app-border, #e2e8f0)',
                                borderRadius: '14px',
                                padding: '16px',
                                boxShadow: 'var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.05))',
                                transition: 'all 200ms ease',
                                position: 'relative',
                                overflow: 'hidden'
                            }}>
                                {/* Gradient background blob */}
                                <div style={{
                                    position: 'absolute', top: '-15px', right: '-15px',
                                    width: '70px', height: '70px', borderRadius: '50%',
                                    background: stat.gradient,
                                    opacity: 0.08,
                                    filter: 'blur(10px)'
                                }}/>

                                {/* Icon */}
                                <div style={{
                                    width: '36px', height: '36px',
                                    borderRadius: '10px',
                                    background: stat.gradient,
                                    boxShadow: `0 4px 12px ${stat.shadow}`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: '#fff', fontSize: '15px',
                                    marginBottom: '12px',
                                    flexShrink: 0
                                }}>
                                    <i className={`bi ${stat.icon}`}/>
                                </div>

                                {/* Label */}
                                <div style={{
                                    fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.04em',
                                    textTransform: 'uppercase', color: 'var(--text-muted, #64748b)',
                                    marginBottom: '4px'
                                }}>
                                    {stat.label}
                                </div>

                                {/* Value */}
                                <div style={{
                                    fontFamily: 'Outfit, sans-serif',
                                    fontSize: '26px', fontWeight: 700,
                                    color: 'var(--text-primary, #0f172a)',
                                    lineHeight: 1
                                }}>
                                    {stat.value ?? <span style={{ fontSize: '18px', opacity: 0.3 }}>—</span>}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <DataTable
                columns={columns}
                data={rooms}
                loading={loading}
                searchTerm={searchTerm}
                onSearch={handleSearch}
                rightActions={
                    <div className="d-flex flex-wrap gap-2 justify-content-md-end">
                        {!isDeptAdmin && (
                            <select className="form-select form-select-sm bg-light rounded-pill border-0 px-3 w-auto" value={deptFilter} onChange={(e) => { setDeptFilter(e.target.value); setPage(1); }}>
                                <option value="">All Departments</option>
                                <option value="shared">Shared / General</option>
                                {departments.map(d => (
                                    <option key={d.id} value={d.id}>{d.name}</option>
                                ))}
                            </select>
                        )}
                        <select className="form-select form-select-sm bg-light rounded-pill border-0 px-3 w-auto" value={buildingFilter} onChange={handleBuildingFilter}>
                            <option value="">All Buildings</option>
                            {buildings.map(b => (
                                <option key={b.id} value={b.name}>{b.name}</option>
                            ))}
                        </select>
                        <select className="form-select form-select-sm bg-light rounded-pill border-0 px-3 w-auto" value={floorFilter} onChange={handleFloorFilter}>
                            <option value="">All Floors</option>
                            <option value="A">Ground Floor (A)</option>
                            <option value="B">First Floor (B)</option>
                            <option value="C">Second Floor (C)</option>
                            <option value="D">Third Floor (D)</option>
                            <option value="E_PLUS">Fourth Floor & Above (E+, 6)</option>
                            <option value="OTHER">Other / Fields (e.g. Fld)</option>
                        </select>
                    </div>
                }
                page={page}
                totalPages={totalPages}
                totalRows={totalRows}
                setPage={setPage}
                searchPlaceholder="Search rooms..."
                emptyMessage="No rooms found. Add your first room to get started."
                emptyIcon="bi-building"
                renderRow={(room) => (
                    <tr key={room.id}>
                        <td style={{ paddingLeft: '16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <div style={{
                                    width: '34px', height: '34px',
                                    borderRadius: '8px',
                                    background: room.is_lab ? 'var(--info-light)' : 'var(--primary-50)',
                                    border: `1px solid ${room.is_lab ? 'rgba(59,130,246,0.2)' : 'var(--primary-100)'}`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: room.is_lab ? 'var(--info)' : 'var(--accent)',
                                    fontSize: '15px'
                                }}>
                                    <i className={room.is_lab ? 'bi bi-pc-display' : 'bi bi-easel2'}/>
                                </div>
                                <div>
                                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: '15px' }}>{room.room_number}</div>
                                </div>
                            </div>
                        </td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: '13.5px' }}>{room.building || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not specified</span>}</td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: '13.5px' }}>{room.department_name || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Shared</span>}</td>
                        <td>
                            {room.is_lab ? (
                                <span className="badge badge-info"><i className="bi bi-pc-display" style={{ marginRight: '4px' }}/>Lab</span>
                            ) : (
                                <span className="badge badge-secondary"><i className="bi bi-easel2" style={{ marginRight: '4px' }}/>Lecture</span>
                            )}
                        </td>
                        <td>
                            {room.is_smart_room === 1 ? (
                                <span className="badge" style={{ background: 'linear-gradient(135deg,#f59e0b,#fbbf24)', color: '#fff' }}>
                                    🌟 Smart
                                </span>
                            ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>
                            )}
                        </td>
                        <td style={{ fontSize: '13.5px', color: 'var(--text-secondary)' }}>
                            <i className="bi bi-person" style={{ marginRight: '4px', color: 'var(--text-muted)' }}/>
                            {room.capacity}
                        </td>
                        <td>
                            {(() => {
                                const allocCount = room.is_lab ? (room.lab_allocation_count || 0) : (room.theory_allocation_count || 0);
                                if (!room.is_active) {
                                    return <span className="badge badge-danger">Inactive</span>;
                                } else if (allocCount >= 2) {
                                    return <span className="badge badge-danger">Full / Shared ({allocCount})</span>;
                                } else if (allocCount === 1) {
                                    return <span className="badge badge-warning text-dark">Assigned (1)</span>;
                                } else {
                                    return <span className="badge badge-success">Unassigned</span>;
                                }
                            })()}
                        </td>
                        <td style={{ paddingRight: '16px' }}>
                            <ActionButtons
                                onEdit={() => openEditModal(room)}
                                onDelete={() => handleDelete(room.id, room.room_number)}
                            />
                        </td>
                    </tr>
                )}
            />

            <FormModal
                show={showModal}
                title={editItem ? 'Edit Room' : 'Add Room'}
                onClose={() => setShowModal(false)}
                onSubmit={handleSubmit(onSubmit)}
                isSubmitting={isSubmitting}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                            <label className="form-label">Room Number <span style={{ color: 'var(--danger)' }}>*</span></label>
                            <input
                                type="text"
                                className={`form-control ${errors.room_number ? 'is-invalid' : ''}`}
                                placeholder="e.g., 101, Lab-4"
                                {...register('room_number', { required: 'Room number is required' })}
                                autoFocus
                            />
                            {errors.room_number && <div className="invalid-feedback">{errors.room_number.message}</div>}
                        </div>
                        <div>
                            <label className="form-label">Building</label>
                            <select className="form-select" {...register('building')}>
                                <option value="">Select Building</option>
                                <option value="A Block">A Block</option>
                                <option value="B Block">B Block</option>
                                <option value="C Block">C Block</option>
                                <option value="D Block">D Block</option>
                                <option value="E Block">E Block</option>
                            </select>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        {!isDeptAdmin && (
                            <div className="col-md-6 mb-3">
                                <label className="form-label">Primary Department (Optional)</label>
                                <select className="form-select" {...register('department_id')}>
                                    <option value="">Shared / General Room</option>
                                    {departments.map(d => (
                                        <option key={d.id} value={d.id}>{d.name}</option>
                                    ))}
                                </select>
                                <div className="form-text">Leave blank for shared/general purpose rooms</div>
                            </div>
                        )}
                        <div>
                            <label className="form-label">Seat Capacity <span style={{ color: 'var(--danger)' }}>*</span></label>
                            <input
                                type="number"
                                className={`form-control ${errors.capacity ? 'is-invalid' : ''}`}
                                min="1"
                                {...register('capacity', { required: 'Capacity is required', min: { value: 1, message: 'Min 1 seat' } })}
                            />
                            {errors.capacity && <div className="invalid-feedback">{errors.capacity.message}</div>}
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '10px',
                            padding: '12px', background: 'var(--app-surface-2)',
                            border: '1px solid var(--app-border)', borderRadius: 'var(--radius-md)'
                        }}>
                            <input type="checkbox" id="isLab" style={{ margin: 0, cursor: 'pointer' }} {...register('is_lab')}/>
                            <label htmlFor="isLab" style={{ cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)', margin: 0 }}>
                                Is Laboratory?
                            </label>
                        </div>
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '10px',
                            padding: '12px', background: '#fffbeb',
                            border: '1px solid #fcd34d', borderRadius: 'var(--radius-md)'
                        }}>
                            <input type="checkbox" id="isSmartRoom" style={{ margin: 0, cursor: 'pointer' }} {...register('is_smart_room')}/>
                            <label htmlFor="isSmartRoom" style={{ cursor: 'pointer', fontSize: '13px', color: '#92400e', margin: 0, fontWeight: 600 }}>
                                <i className="bi bi-stars me-1 text-warning"></i>Smart Room
                            </label>
                        </div>
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '10px',
                            padding: '12px', background: 'var(--app-surface-2)',
                            border: '1px solid var(--app-border)', borderRadius: 'var(--radius-md)'
                        }}>
                            <input type="checkbox" id="roomActive" style={{ margin: 0, cursor: 'pointer' }} {...register('is_active')}/>
                            <label htmlFor="roomActive" style={{ cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)', margin: 0 }}>
                                Room Active
                            </label>
                        </div>
                    </div>
                    {/* Smart Room explanation */}
                    <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: '12px', color: '#92400e' }}>
                        <i className="bi bi-info-circle me-2 text-warning"></i>
                        <strong>Smart Room</strong> — Mark a room as Smart if it is reserved for specific classes only (e.g., a premium computer lab for a particular course). This helps the timetable generator and allocator prioritize these rooms correctly.
                    </div>
                </div>
            </FormModal>

            {/* Bulk Upload Modal */}
            <FormModal 
                show={showBulkUpload} 
                title="Bulk Upload Rooms" 
                onClose={() => setShowBulkUpload(false)}
                onSubmit={handleBulkUpload}
                isSubmitting={isUploading}
                submitText="Upload"
            >
                <div className="mb-3 p-3 rounded-3" style={{ background: '#fffbeb', border: '1px solid #fcd34d' }}>
                    <div className="d-flex align-items-start gap-2">
                        <i className="bi bi-stars text-warning mt-1"></i>
                        <div className="small" style={{ color: '#92400e' }}>
                            <strong>Smart Room Note:</strong> The bulk upload CSV does not include a Smart Room column. After uploading, if any room needs to be marked as <strong>Smart</strong>, please use the <strong>Edit (pencil) button</strong> on that room row to enable it manually.
                        </div>
                    </div>
                </div>

                <div className="mb-4 text-center">
                    <i className="bi bi-file-earmark-spreadsheet text-success mb-2" style={{ fontSize: '3rem' }}></i>
                    <h5 className="fw-bold text-dark mt-2">Download Template</h5>
                    <p className="text-muted small mb-2">Please use the standard Excel/CSV template for bulk uploading rooms.</p>
                    <p className="small mb-2 fw-semibold">Mandatory fields: Room Number, Capacity</p>
                    <p className="small mb-3 text-primary fw-semibold"><i className="bi bi-info-circle me-1"></i>Note: For 'Department Code', enter a department short code (e.g. CSE, ME, CE, BCA). Write 'Shared' or leave blank to make it a Shared / Common room.</p>
                    <button type="button" onClick={handleDownloadTemplate} className="btn btn-sm btn-outline-success rounded-pill px-4">
                        <i className="bi bi-download me-2"></i> Download Template
                    </button>
                </div>

                <div className="mb-4">
                    <label className="form-label fw-bold text-dark">Upload Excel/CSV File <span className="text-danger">*</span></label>
                    <input 
                        type="file" 
                        className="form-control bg-light" 
                        accept=".csv, .xlsx, .xls"
                        onChange={(e) => setBulkFile(e.target.files[0])}
                        required
                    />
                </div>

                {bulkSummary && (
                    <div className="alert alert-info py-2 small mb-3 border-0 shadow-sm">
                        <i className="bi bi-info-circle-fill me-2"></i>
                        Upload complete. 
                        Added: <span className="fw-bold">{bulkSummary.inserted}</span>, 
                        Skipped: <span className="fw-bold">{bulkSummary.skipped}</span>, 
                        Errors: <span className="fw-bold">{bulkSummary.errors}</span>
                    </div>
                )}

                {bulkErrors && (
                    <div className="alert alert-danger p-0 overflow-hidden shadow-sm border-0 mt-3 rounded-3">
                        <div className="bg-danger bg-opacity-10 px-3 py-2 border-bottom border-danger border-opacity-25 fw-bold text-danger small">
                            <i className="bi bi-exclamation-octagon-fill me-2"></i> Errors found:
                        </div>
                        <ul className="list-group list-group-flush small" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                            {bulkErrors.map((err, i) => (
                                <li key={i} className="list-group-item bg-transparent text-danger py-1 px-3 border-0">{err}</li>
                            ))}
                        </ul>
                    </div>
                )}
            </FormModal>
        </div>
    );
};

export default Rooms;
