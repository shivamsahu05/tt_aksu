import React, { useState, useEffect, useMemo, useRef } from 'react';
import api from '../../utils/api';
import PageHeader from '../../components/common/PageHeader';
import { useReactToPrint } from 'react-to-print';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import logoImg from '../../assets/logo.png';

const TimetableAnalysis = () => {
    const [sessions, setSessions] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [selectedSession, setSelectedSession] = useState('');
    const [selectedDepartment, setSelectedDepartment] = useState('');
    const [schema, setSchema] = useState({ days: [], slots: [] });
    const [rooms, setRooms] = useState([]);
    const [timetable, setTimetable] = useState([]);
    const [orientation, setOrientation] = useState('landscape');
    const orientationRef = useRef(orientation);
    useEffect(() => { orientationRef.current = orientation; }, [orientation]);
    const [loading, setLoading] = useState(false);
    const printRef = useRef();
    const [logoBase64, setLogoBase64] = useState(null);

    // Filters for Deep Analysis
    const [selectedDay, setSelectedDay] = useState('');
    const [selectedSlot, setSelectedSlot] = useState('');
    const [selectedRoomType, setSelectedRoomType] = useState('all'); // all, theory, lab, mixed

    useEffect(() => {
        const loadLogo = async () => {
            try {
                const response = await fetch(logoImg);
                const blob = await response.blob();
                const reader = new FileReader();
                reader.onloadend = () => { setLogoBase64(reader.result); };
                reader.readAsDataURL(blob);
            } catch (e) { console.error("Error loading logo", e); }
        };
        loadLogo();
    }, []);

    useEffect(() => {
        setSelectedRoomType('all');
    }, [selectedDepartment]);

    useEffect(() => {
        const fetchInitial = async () => {
            try {
                const [sessRes, deptRes, schemaRes, roomsRes] = await Promise.all([
                    api.get('/sessions?limit=100'),
                    api.get('/departments?limit=100'),
                    api.get('/timetable/schema'),
                    api.get('/rooms?limit=1000')
                ]);

                if (sessRes.data.success) {
                    setSessions(sessRes.data.data);
                    const active = sessRes.data.data.find(s => s.is_active);
                    if (active) setSelectedSession(active.id.toString());
                }
                if (deptRes.data.success) {
                    setDepartments(deptRes.data.data);
                }
                if (schemaRes.data.success) {
                    setSchema(schemaRes.data.data);
                    if (schemaRes.data.data.days.length > 0) setSelectedDay(schemaRes.data.data.days[0].id.toString());
                    const firstWorkingSlot = schemaRes.data.data.slots.find(s => s.slot_type !== 'break');
                    if (firstWorkingSlot) setSelectedSlot(firstWorkingSlot.id.toString());
                }
                if (roomsRes.data.success) {
                    setRooms(roomsRes.data.data);
                }
            } catch (error) {
                console.error("Failed to fetch initial data for analysis", error);
            }
        };
        fetchInitial();
    }, []);

    useEffect(() => {
        const fetchTimetable = async () => {
            if (!selectedSession) return;
            setLoading(true);
            try {
                let url = `/timetable?session_id=${selectedSession}`;
                if (selectedDepartment) {
                    url += `&department_id=${selectedDepartment}`;
                }
                const res = await api.get(url);
                if (res.data.success) {
                    setTimetable(res.data.data);
                }
            } catch (error) {
                console.error("Failed to fetch timetable", error);
            } finally {
                setLoading(false);
            }
        };
        fetchTimetable();
    }, [selectedSession, selectedDepartment]);

    // Data Processing for Occupancy Matrix
    const roomOccupancyMap = useMemo(() => {
        const map = new Map();
        rooms.forEach(room => {
            if (selectedDepartment && room.department_id?.toString() !== selectedDepartment.toString()) {
                return;
            }
            map.set(room.id, {
                room: room,
                slots: new Map() // key: "dayId_slotId", value: array of entries
            });
        });

        timetable.forEach(entry => {
            if (entry.room_id && map.has(entry.room_id)) {
                const key = `${entry.day_id}_${entry.time_slot_id}`;
                const roomData = map.get(entry.room_id);
                if (!roomData.slots.has(key)) {
                    roomData.slots.set(key, []);
                }
                roomData.slots.get(key).push(entry);
            }
        });

        return map;
    }, [rooms, timetable, selectedDepartment]);

    // Helper to match room types robustly across theory, lab, mixed, both, etc.
    const matchesRoomTypeFilter = (room, filterType) => {
        if (!filterType || filterType === 'all') return true;
        const rType = String(room.room_type || '').toLowerCase();
        if (filterType === 'theory') return rType === 'theory' || rType === 'lecture';
        if (filterType === 'lab') return rType === 'lab';
        if (filterType === 'mixed') return rType === 'mixed' || rType === 'both';
        return rType === String(filterType).toLowerCase();
    };

    // Computed Free Rooms for Finder
    const freeRooms = useMemo(() => {
        if (!selectedDay || !selectedSlot) return [];

        const isBreak = schema.slots.find(s => s.id.toString() === selectedSlot)?.slot_type === 'break';
        if (isBreak) return []; // No classes during break

        const available = [];
        const key = `${selectedDay}_${selectedSlot}`;

        roomOccupancyMap.forEach(roomData => {
            // Filter by room type if requested
            if (!matchesRoomTypeFilter(roomData.room, selectedRoomType)) return;

            const entries = roomData.slots.get(key) || [];
            if (entries.length === 0) {
                available.push(roomData.room);
            }
        });

        return available.sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
    }, [roomOccupancyMap, selectedDay, selectedSlot, selectedRoomType, schema.slots]);

    const matricesToRender = useMemo(() => {
        const result = [];
        const roomArray = Array.from(roomOccupancyMap.values()).filter(data => matchesRoomTypeFilter(data.room, selectedRoomType));

        if (selectedDepartment) {
            const dept = departments.find(d => d.id.toString() === selectedDepartment);
            if (roomArray.length > 0) {
                result.push({
                    departmentId: dept ? dept.id : null,
                    title: `Room Occupancy Matrix - ${dept?.name || 'Department'}`,
                    rooms: roomArray
                });
            }
        } else {
            departments.forEach(dept => {
                const deptRooms = roomArray.filter(r => r.room.department_id === dept.id);
                if (deptRooms.length > 0) {
                    result.push({
                        departmentId: dept.id,
                        title: `Room Occupancy Matrix - ${dept.name}`,
                        rooms: deptRooms
                    });
                }
            });

            const sharedRooms = roomArray.filter(r => !r.room.department_id);
            if (sharedRooms.length > 0) {
                result.push({
                    departmentId: 'shared',
                    title: `Room Occupancy Matrix - Shared/General Rooms`,
                    rooms: sharedRooms
                });
            }
        }

        return result;
    }, [roomOccupancyMap, departments, selectedDepartment, selectedRoomType]);

    // Render Helpers
    const getSlotName = (slotId) => {
        const s = schema.slots.find(s => s.id.toString() === slotId.toString());
        if (!s) return '';
        return s.slot_type === 'break' ? 'BREAK' : `P${s.slot_order} (${s.start_time.substring(0, 5)})`;
    };

    const getDayName = (dayId) => {
        return schema.days.find(d => d.id.toString() === dayId.toString())?.name || '';
    };

    // Export Handlers
    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: 'Room_Occupancy_Matrix',
        pageStyle: () => `@page { size: ${orientationRef.current} a3; margin: 5mm; }`,
    });

    const handleDownloadPDF = () => {
        const doc = new jsPDF(orientation, 'mm', 'a3');
        doc.setFontSize(14);

        matricesToRender.forEach((matrix, index) => {
            if (index > 0) doc.addPage();

            const printDate = new Date().toLocaleString('en-IN');

            if (logoBase64) {
                doc.addImage(logoBase64, 'PNG', 14, 8, 14, 14);
                doc.setFontSize(16);
                doc.text("AKS University", 32, 14);
                doc.setFontSize(12);
                doc.text(`${matrix.title} (Filter: ${selectedRoomType})`, 32, 21);
            } else {
                doc.setFontSize(16);
                doc.text("AKS University", 14, 12);
                doc.setFontSize(12);
                doc.text(`${matrix.title} (Filter: ${selectedRoomType})`, 14, 20);
            }
            doc.setFontSize(9);
            doc.text(`Printed on: ${printDate}`, 14, 26);

            const head1 = [
                { content: 'Room', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
                { content: 'Cap', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } }
            ];
            const head2 = [];

            schema.days.forEach(day => {
                head1.push({ content: day.name, colSpan: schema.slots.length, styles: { halign: 'center' } });
                schema.slots.forEach(slot => {
                    head2.push(slot.slot_type === 'break' ? 'B\nR\nK' : `P${slot.slot_order}`);
                });
            });

            const body = [];
            matrix.rooms.forEach((data, rIdx) => {
                const isSharedRoom = !data.room.department_id;
                const roomLabel = isSharedRoom
                    ? `${data.room.room_number} [SHARED]\n(${data.room.department_code || data.room.department_name || 'General'})`
                    : `${data.room.room_number}\n(${data.room.department_code || data.room.department_name || ''})`;
                const row = [roomLabel, data.room.capacity];

                schema.days.forEach(day => {
                    schema.slots.forEach(slot => {
                        if (slot.slot_type === 'break') {
                            row.push('BREAK_CELL');
                        } else {
                            const key = `${day.id}_${slot.id}`;
                            const entries = data.slots.get(key) || [];
                            if (entries.length > 0) {
                                row.push(''); // No text for occupied cells as requested
                            } else {
                                row.push('F'); // Show Free text
                            }
                        }
                    });
                });
                body.push(row);
            });

            autoTable(doc, {
                head: [head1, head2],
                body: body,
                startY: 30,
                theme: 'grid',
                styles: { fontSize: 7, cellPadding: 1, halign: 'center', valign: 'middle' },
                headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', lineWidth: 0.1, lineColor: [200, 200, 200] },
                bodyStyles: { lineWidth: 0.1, lineColor: [200, 200, 200] },
                didParseCell: function (data) {
                    if (data.section === 'body') {
                        if (data.cell.raw === 'BREAK_CELL') {
                            data.cell.text = []; // Clear the text
                            data.cell.styles.fillColor = [233, 236, 239]; // Gray
                        } else if (data.cell.raw === '') {
                            // Occupied cell
                            data.cell.styles.fillColor = [248, 215, 218]; // Light red
                        } else if (data.cell.raw === 'Free') {
                            // Free cell
                            data.cell.styles.fillColor = [255, 255, 255]; // White
                            data.cell.styles.textColor = [100, 100, 100];
                            data.cell.styles.fontStyle = 'bold';
                            data.cell.styles.fontSize = 9;
                        }

                        // Style shared room rows — column 0 is the Room column
                        if (data.column.index === 0 && typeof data.cell.raw === 'string' && data.cell.raw.includes('[SHARED]')) {
                            data.cell.styles.fillColor = [219, 234, 254]; // Light blue background
                            data.cell.styles.textColor = [29, 78, 216];   // Blue text
                            data.cell.styles.fontStyle = 'bold';
                            data.cell.styles.halign = 'left';
                        }

                        // Add dark border between days (except the last column)
                        if (data.column.index >= 2 && ((data.column.index - 1) % schema.slots.length === 0)) {
                            data.cell.styles.lineWidth = { top: 0.1, bottom: 0.1, left: 0.1, right: 0.6 };
                            data.cell.styles.lineColor = [0, 0, 0];
                        }
                    }
                }
            });
        });

        const deptName = selectedDepartment ? departments.find(d => d.id.toString() === selectedDepartment)?.name : 'All_Departments';
        doc.save(`Room_Occupancy_Matrix_${deptName.replace(/\s+/g, '_')}.pdf`);
    };

    const handleExportExcel = () => {
        const wb = XLSX.utils.book_new();
        const dateStr = new Date().toLocaleDateString('en-GB');

        matricesToRender.forEach((matrix, index) => {
            const timeStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

            const wsData = [];
            wsData.push(["AKS University"]);
            wsData.push([matrix.title]);
            wsData.push([`Room Filter: ${selectedRoomType} | Printed on: ${dateStr}, ${timeStr}`]);
            wsData.push([]);

            const headerRow1 = ['Room', 'Cap'];
            const headerRow2 = ['', ''];

            schema.days.forEach(day => {
                headerRow1.push(day.name);
                for (let i = 1; i < schema.slots.length; i++) headerRow1.push(''); // Merge placeholders

                schema.slots.forEach(slot => {
                    headerRow2.push(slot.slot_type === 'break' ? 'BRK' : `P${slot.slot_order}`);
                });
            });
            wsData.push(headerRow1);
            wsData.push(headerRow2);

            matrix.rooms.forEach(data => {
                const row = [`${data.room.room_number} (${data.room.department_code || data.room.department_name || ''})`, data.room.capacity];

                schema.days.forEach(day => {
                    schema.slots.forEach(slot => {
                        if (slot.slot_type === 'break') {
                            if (rIdx === 0) {
                                row.push('B R E A K');
                            } else {
                                row.push('');
                            }
                        } else {
                            const key = `${day.id}_${slot.id}`;
                            const entries = data.slots.get(key) || [];
                            if (entries.length > 0) {
                                row.push([...new Set(entries.map(e => e.subject_code))].join(', '));
                            } else {
                                row.push('Free');
                            }
                        }
                    });
                });
                wsData.push(row);
            });

            const ws = XLSX.utils.aoa_to_sheet(wsData);

            if (!ws['!merges']) ws['!merges'] = [];
            ws['!merges'].push(
                { s: { r: 0, c: 0 }, e: { r: 0, c: headerRow1.length - 1 } },
                { s: { r: 1, c: 0 }, e: { r: 1, c: headerRow1.length - 1 } },
                { s: { r: 2, c: 0 }, e: { r: 2, c: headerRow1.length - 1 } }
            );

            ws['!merges'].push(
                { s: { r: 4, c: 0 }, e: { r: 5, c: 0 } },
                { s: { r: 4, c: 1 }, e: { r: 5, c: 1 } }
            );

            let currentC = 2;
            schema.days.forEach(day => {
                ws['!merges'].push({ s: { r: 4, c: currentC }, e: { r: 4, c: currentC + schema.slots.length - 1 } });

                let slotC = currentC;
                schema.slots.forEach(slot => {
                    if (slot.slot_type === 'break' && matrix.rooms.length > 0) {
                        ws['!merges'].push({ s: { r: 6, c: slotC }, e: { r: 6 + matrix.rooms.length - 1, c: slotC } });
                    }
                    slotC++;
                });

                currentC += schema.slots.length;
            });

            ws['!cols'] = [{ wch: 25 }, { wch: 8 }];
            for (let i = 2; i < headerRow1.length; i++) ws['!cols'].push({ wch: 15 });

            let sheetName = matrix.title.replace('Room Occupancy Matrix - ', '').substring(0, 31).replace(/[\\/?*[\]]/g, '');
            if (wb.SheetNames.includes(sheetName)) sheetName = sheetName.substring(0, 27) + `_${index}`;

            XLSX.utils.book_append_sheet(wb, ws, sheetName);
        });

        XLSX.writeFile(wb, 'Room_Occupancy_Matrix.xlsx');
    };

    return (
        <div className="container-fluid px-2 px-md-4 py-3 py-md-4">
            <PageHeader
                title="Deep Timetable Analysis"
                icon="bi-graph-up-arrow"
                rightContent={
                    <div className="d-flex align-items-center gap-2 flex-wrap w-100 justify-content-sm-end">
                        <select
                            className="form-select bg-white flex-grow-1 flex-sm-grow-0"
                            style={{ minWidth: '160px', width: 'auto' }}
                            value={selectedSession}
                            onChange={e => setSelectedSession(e.target.value)}
                        >
                            {sessions.map(s => <option key={s.id} value={s.id}>{s.name || s.session_name}</option>)}
                        </select>
                        <select
                            className="form-select bg-white flex-grow-1 flex-sm-grow-0"
                            style={{ minWidth: '160px', width: 'auto' }}
                            value={selectedDepartment}
                            onChange={e => setSelectedDepartment(e.target.value)}
                        >
                            <option value="">All Departments</option>
                            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                    </div>
                }
            />

            {loading ? (
                <div className="text-center my-5">
                    <div className="spinner-border text-primary" role="status"></div>
                </div>
            ) : (
                <div className="row g-3 g-md-4">
                    {/* Free Rooms Finder */}
                    <div className="col-lg-3 mb-3 mb-md-4">
                        <div className="card shadow-sm h-100">
                            <div className="card-header bg-white border-bottom-0 p-3 p-md-4 pb-0">
                                <h5 className="mb-0 fw-bold"><i className="bi bi-search text-primary me-2"></i>Free Rooms Finder</h5>
                                <p className="text-muted small mt-1">Select a specific time to see which rooms are currently empty.</p>
                            </div>
                            <div className="card-body bg-light rounded m-2 m-md-3 p-2 p-md-3">
                                <div className="mb-3">
                                    <label className="form-label fw-medium small">Day of Week</label>
                                    <select className="form-select" value={selectedDay} onChange={e => setSelectedDay(e.target.value)}>
                                        {schema.days.map(d => (
                                            <option key={d.id} value={d.id}>{d.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="mb-3">
                                    <label className="form-label fw-medium small">Time Slot</label>
                                    <select className="form-select" value={selectedSlot} onChange={e => setSelectedSlot(e.target.value)}>
                                        {schema.slots.map(s => (
                                            <option key={s.id} value={s.id} disabled={s.slot_type === 'break'}>
                                                {s.slot_type === 'break' ? 'BREAK' : `P${s.slot_order} - ${s.start_time.substring(0, 5)} to ${s.end_time.substring(0, 5)}`}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="mb-3">
                                    <label className="form-label fw-medium small">Room Type Filter</label>
                                    <select className="form-select" value={selectedRoomType} onChange={e => setSelectedRoomType(e.target.value)}>
                                        <option value="all">All Types</option>
                                        <option value="theory">Theory Rooms</option>
                                        <option value="lab">Labs</option>
                                        <option value="mixed">Share/Mixed Rooms</option>
                                    </select>
                                </div>
                            </div>

                            <div className="px-2 px-md-3 pb-3 pb-md-4">
                                <div className="d-flex justify-content-between align-items-center mb-3">
                                    <span className="fw-bold">Available Rooms: <span className="badge bg-success rounded-pill ms-1">{freeRooms.length}</span></span>
                                    {selectedDay && selectedSlot && (
                                        <span className="badge bg-primary text-white">
                                            {getDayName(selectedDay)} {getSlotName(selectedSlot)}
                                        </span>
                                    )}
                                </div>

                                <div className="list-group list-group-flush border rounded" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                                    {freeRooms.length === 0 ? (
                                        <div className="list-group-item text-center text-muted p-4">
                                            No rooms available at this time.
                                        </div>
                                    ) : (
                                        freeRooms.map(room => (
                                            <div key={room.id} className="list-group-item d-flex justify-content-between align-items-center py-2 px-2 px-md-3">
                                                <div>
                                                    <div className="fw-bold">{room.room_number}</div>
                                                    <div className="small text-muted" style={{ textTransform: 'capitalize' }}>
                                                        {room.room_type} Room
                                                        {!selectedDepartment && room.department_name && (
                                                            <span className="ms-1 border-start ps-1 border-secondary-subtle" title={room.department_name}>
                                                                {room.department_code || room.department_name} <span className="text-secondary opacity-75">({room.building || 'N/A'})</span>
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="text-end">
                                                    <span className="badge bg-light text-dark border">
                                                        <i className="bi bi-people-fill me-1 text-muted"></i>{room.capacity}
                                                    </span>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Room Occupancy Matrix */}
                    <div className="col-lg-9 mb-3 mb-md-4">
                        <div className="card shadow-sm h-100">
                            <div className="card-header bg-white border-bottom-0 p-3 p-md-4 pb-2">
                                <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-center gap-3">
                                    <div>
                                        <h5 className="mb-0 fw-bold"><i className="bi bi-grid-3x3 text-primary me-2"></i>Room Occupancy Matrix</h5>
                                        <p className="text-muted small mt-1 mb-0">A visual heatmap of room utilization across all days and slots.</p>
                                    </div>
                                    {selectedRoomType !== 'all' && (
                                        <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-3 py-2 ms-md-3 d-none d-md-inline-block">
                                            Filtered: {selectedRoomType === 'theory' ? 'Theory Rooms' : selectedRoomType === 'lab' ? 'Computer Labs' : 'Mixed Rooms'}
                                        </span>
                                    )}
                                    <div className="d-flex gap-2 ms-md-auto align-items-center flex-wrap w-100 w-md-auto">
                                        <select className="form-select form-select-sm border-secondary" style={{ width: 'auto' }} value={orientation} onChange={(e) => setOrientation(e.target.value)}>
                                            <option value="landscape">Landscape</option>
                                            <option value="portrait">Portrait</option>
                                        </select>
                                        <button className="btn btn-sm btn-outline-primary" onClick={handlePrint} title="Print Matrix">
                                            <i className="bi bi-printer"></i><span className="d-none d-md-inline ms-1">Print</span>
                                        </button>
                                        <button className="btn btn-sm btn-outline-danger" onClick={handleDownloadPDF} title="Download PDF">
                                            <i className="bi bi-file-pdf"></i><span className="d-none d-md-inline ms-1">PDF</span>
                                        </button>
                                        <button className="btn btn-sm btn-outline-success" onClick={handleExportExcel} title="Export to Excel">
                                            <i className="bi bi-file-excel"></i><span className="d-none d-md-inline ms-1">Excel</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div className="card-body p-0" ref={printRef}>
                                <style>{`
                                    .print-text { display: none; }
                                    .analysis-table th.day-end-border, .analysis-table td.day-end-border { border-right: 2px solid #343a40 !important; }
                                    @media print {
                                        @page { size: ${orientation} a3; margin: 5mm; }
                                        body { font-size: 8pt !important; }
                                        .no-print { display: none !important; }
                                        .print-text { display: block !important; }
                                        .hide-on-print { display: none !important; }
                                        .analysis-table th, .analysis-table td { padding: 2px !important; border: 1px solid #dee2e6 !important; }
                                        .analysis-table th { background-color: #f8f9fa !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                                        .analysis-table td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                                        .table-responsive { overflow: visible !important; max-height: none !important; }
                                        .analysis-table th.day-end-border, .analysis-table td.day-end-border { border-right: 2px solid #000 !important; }
                                        .print-matrix-page { page-break-after: always; }
                                        .print-matrix-page:last-child { page-break-after: auto; }
                                    }
                                `}</style>

                                {matricesToRender.length === 0 ? (
                                    <div className="text-center py-5 text-muted">
                                        No rooms found matching the selected room type filter.
                                    </div>
                                ) : matricesToRender.map((matrix, mIdx) => (
                                    <div key={matrix.departmentId || mIdx} className="print-matrix-page mb-5">
                                        <div className="d-none d-print-block text-center mb-4">
                                            <div className="d-flex justify-content-center align-items-center mb-1">
                                                <img src={logoImg} alt="Logo" style={{ width: '40px', height: '40px', objectFit: 'contain', marginRight: '10px' }} />
                                                <h3 className="fw-bold m-0 p-0" style={{ fontSize: '18pt' }}>AKS University</h3>
                                            </div>
                                            <h5 className="fw-bold mt-1 mb-1" style={{ fontSize: '14pt' }}>{matrix.title}</h5>
                                            <div className="text-muted" style={{ fontSize: '10pt' }}>Printed on: {new Date().toLocaleString('en-IN')}</div>
                                        </div>
                                        <div className="table-responsive" style={{ maxHeight: '800px', overflowY: 'auto', overflowX: 'auto', width: '100%' }}>
                                            <table id={`matrix-table-${mIdx}`} className="table table-bordered table-sm text-center mb-0 analysis-table" style={{ minWidth: '950px', fontSize: '11px', whiteSpace: 'nowrap' }}>
                                                <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 12 }}>
                                                    <tr>
                                                        <th className="align-middle" rowSpan={2} style={{ minWidth: '90px', position: 'sticky', left: 0, zIndex: 13, background: '#f8f9fa' }}>Room</th>
                                                        <th className="align-middle" rowSpan={2} style={{ width: '40px', background: '#f8f9fa' }}>Cap</th>
                                                        {schema.days.map(day => (
                                                            <th key={day.id} colSpan={schema.slots.length} className="border-start border-end fw-bold text-dark text-uppercase">
                                                                {day.name}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                    <tr>
                                                        {schema.days.map(day => (
                                                            schema.slots.map(slot => {
                                                                const isBreak = slot.slot_type === 'break';
                                                                const isLastSlot = slot.id === schema.slots[schema.slots.length - 1].id;
                                                                return (
                                                                    <th
                                                                        key={`${day.id}-${slot.id}`}
                                                                        className={"fw-bold text-dark" + (isLastSlot ? " day-end-border" : "")}
                                                                        style={{
                                                                            width: isBreak ? '20px' : '28px',
                                                                            background: isBreak ? '#e9ecef' : '#f8f9fa',
                                                                            verticalAlign: 'middle',
                                                                            padding: '2px 0'
                                                                        }}
                                                                        title={isBreak ? `BREAK (${slot.start_time.substring(0, 5)})` : `P${slot.slot_order} - ${slot.start_time.substring(0, 5)}`}
                                                                    >
                                                                        {isBreak ? (
                                                                            <div className="fw-bold" style={{ lineHeight: '1.1', fontSize: '10px' }}>
                                                                                {'B'.split('').map((char, i) => <div key={i}>{char}</div>)}
                                                                            </div>
                                                                        ) : `P${slot.slot_order}`}
                                                                    </th>
                                                                );
                                                            })
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {matrix.rooms.map((data, rIdx) => (
                                                        <tr key={data.room.id}>
                                                             <td className="fw-bold text-start bg-white" style={{ position: 'sticky', left: 0, zIndex: 5 }}>
                                                                <div className="text-nowrap d-flex align-items-center gap-1">
                                                                    {data.room.room_number}
                                                                    {!data.room.department_id && (
                                                                        <span
                                                                            title="This is a shared/general room not assigned to any specific department"
                                                                            style={{
                                                                                fontSize: '9px',
                                                                                background: '#0d6efd',
                                                                                color: '#fff',
                                                                                borderRadius: '3px',
                                                                                padding: '1px 4px',
                                                                                fontWeight: 'bold',
                                                                                letterSpacing: '0.5px',
                                                                                whiteSpace: 'nowrap'
                                                                            }}
                                                                        >SHARED</span>
                                                                    )}
                                                                </div>
                                                                {!selectedDepartment && data.room.department_name && (
                                                                    <div className="text-muted fw-normal text-truncate" style={{ fontSize: '10px', maxWidth: '120px' }} title={`${data.room.department_name} (${data.room.building || 'N/A'})`}>
                                                                        {data.room.department_code || data.room.department_name} <span className="opacity-75">({data.room.building || 'N/A'})</span>
                                                                    </div>
                                                                )}
                                                                {!data.room.department_id && (
                                                                    <div className="text-muted fw-normal" style={{ fontSize: '10px' }}>General / Shared Room</div>
                                                                )}
                                                            </td>
                                                            <td className="text-muted bg-white">{data.room.capacity}</td>
                                                            {schema.days.map(day => (
                                                                schema.slots.map(slot => {
                                                                    const isLastSlot = slot.id === schema.slots[schema.slots.length - 1].id;
                                                                    if (slot.slot_type === 'break') {
                                                                        if (rIdx === 0) {
                                                                            return (
                                                                                <td
                                                                                    key={`${day.id}_${slot.id}`}
                                                                                    rowSpan={matrix.rooms.length}
                                                                                    title="BREAK"
                                                                                    className={"border-start" + (isLastSlot ? " day-end-border" : "")}
                                                                                    style={{
                                                                                        backgroundColor: '#e9ecef',
                                                                                        cursor: 'default',
                                                                                        padding: '2px 0',
                                                                                        verticalAlign: 'middle'
                                                                                    }}
                                                                                >
                                                                                    <div style={{ fontSize: '12px', color: '#6c757d', fontWeight: 'bold', lineHeight: '1.2', letterSpacing: '2px' }}>
                                                                                        {'BREAK'.split('').map((char, i) => <div key={i}>{char}</div>)}
                                                                                    </div>
                                                                                </td>
                                                                            );
                                                                        }
                                                                        return null;
                                                                    }

                                                                    const key = `${day.id}_${slot.id}`;
                                                                    const entries = data.slots.get(key) || [];
                                                                    const isOccupied = entries.length > 0;

                                                                    let title = 'Free';
                                                                    if (isOccupied) {
                                                                        title = entries.map(e => `${e.subject_code} - ${e.section_name}`).join('\n');
                                                                    }

                                                                    return (
                                                                        <td
                                                                            key={key}
                                                                            title={title}
                                                                            className={(isOccupied ? 'border-start' : 'border-start') + (isLastSlot ? " day-end-border" : "")}
                                                                            style={{
                                                                                backgroundColor: isOccupied ? 'rgba(220, 53, 69, 0.2)' : 'transparent',
                                                                                cursor: 'help',
                                                                                padding: '2px'
                                                                            }}
                                                                        >
                                                                            {isOccupied ? (
                                                                                <>
                                                                                    <div className="hide-on-print" style={{ width: '10px', height: '10px', backgroundColor: '#dc3545', margin: 'auto', borderRadius: '2px' }}></div>
                                                                                    <span className="print-text" style={{ fontSize: '8px', color: '#dc3545', fontWeight: 'bold' }}>{[...new Set(entries.map(e => e.subject_code))].join(', ')}</span>
                                                                                </>
                                                                            ) : (
                                                                                <>
                                                                                    <div className="hide-on-print" style={{ width: '4px', height: '4px', backgroundColor: '#6c757d', margin: 'auto', borderRadius: '50%' }}></div>
                                                                                    <span className="print-text" style={{ fontSize: '11px', color: '#0c0e0eff', fontWeight: 'bold' }}>F</span>
                                                                                </>
                                                                            )}
                                                                        </td>
                                                                    );
                                                                })
                                                            ))}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TimetableAnalysis;
