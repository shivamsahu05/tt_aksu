import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../utils/api';
import { toast } from 'react-toastify';
import { safeDelete, showSuccess } from '../../utils/alerts';
import PageHeader from '../../components/common/PageHeader';
import FormModal from '../../components/common/FormModal';
import { useForm } from 'react-hook-form';
import * as XLSX from 'xlsx';
import Swal from 'sweetalert2';

const Allocations = () => {
    const { user } = useAuth();
    const isDeptAdmin = user?.role === 'DEPARTMENT_ADMIN';
    // Dropdowns
    const [sessions, setSessions] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [selectedSession, setSelectedSession] = useState('');
    const [selectedDepartment, setSelectedDepartment] = useState(isDeptAdmin ? user.department_id : '');
    const [selectedClassFilter, setSelectedClassFilter] = useState('all');
    
    // Data
    const [matrixData, setMatrixData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [currentClassIndex, setCurrentClassIndex] = useState(0);

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [modalMode, setModalMode] = useState('add'); // 'add' or 'edit'
    const [editItem, setEditItem] = useState(null);
    const [activeSection, setActiveSection] = useState(null);
    const [activeSubject, setActiveSubject] = useState(null);
    const [activeAllocType, setActiveAllocType] = useState('theory');
    const [allocationFilter, setAllocationFilter] = useState('all'); // 'all', 'theory', 'lab'
    const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'assigned', 'pending'
    const [activeClassItem, setActiveClassItem] = useState(null);
    
    // Class List Modal
    const [showClassListModal, setShowClassListModal] = useState(false);
    
    // Teachers Modal
    const [showWorkloadModal, setShowWorkloadModal] = useState(false);
    const [workloadSortBy, setWorkloadSortBy] = useState('total_desc');
    const [teachers, setTeachers] = useState([]);
    const [viewTeacherAllocations, setViewTeacherAllocations] = useState(null);
    const [teacherAllocationsData, setTeacherAllocationsData] = useState([]);

    const fileInputRef = React.useRef(null);
    const [uploading, setUploading] = useState(false);

    const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm();

    const fetchDropdowns = async () => {
        try {
            const [sessRes, deptRes] = await Promise.all([
                api.get('/sessions?limit=100'),
                api.get('/departments?limit=100')
            ]);
            
            if (sessRes.data.success) {
                setSessions(sessRes.data.data);
                const activeSession = sessRes.data.data.find(s => s.is_active);
                if (activeSession) {
                    setSelectedSession(activeSession.id.toString());
                }
            }
            if (deptRes.data.success && deptRes.data.data.length > 0) {
                setDepartments(deptRes.data.data);
            }
        } catch (error) {
            console.error('Failed to fetch dropdowns');
        }
    };

    useEffect(() => {
        fetchDropdowns();
    }, []);

    const fetchMatrix = async (resetFilters = true, silent = false) => {
        if (!selectedSession || !selectedDepartment) return;
        try {
            if (!silent) setLoading(true);
            const res = await api.get(`/allocations/matrix?session_id=${selectedSession}&department_id=${selectedDepartment}`);
            if (res.data.success) {
                setMatrixData(res.data.data);
                if (resetFilters) {
                    setSelectedClassFilter('all');
                    setCurrentClassIndex(0);
                }
            }
        } catch (error) {
            toast.error('Failed to fetch allocation matrix');
        } finally {
            if (!silent) setLoading(false);
        }
    };

    useEffect(() => {
        fetchMatrix(true);
    }, [selectedSession, selectedDepartment]);

    // Calculate Stats
    const stats = useMemo(() => {
        let totalCourses = 0;
        let totalRequired = 0;
        let totalRequiredTheory = 0;
        let totalRequiredLab = 0;
        let totalAssigned = 0;
        let totalAssignedTheory = 0;
        let totalAssignedLab = 0;
        const classStatuses = {};

        matrixData.forEach((classItem, index) => {
            let classRequired = 0;
            let classAssigned = 0;
            const uniqueSubjects = [];
            
            classItem.sections.forEach(sec => sec.subjects.forEach(sub => {
                if (!uniqueSubjects.find(s => s.id === sub.id)) {
                    uniqueSubjects.push(sub);
                }
            }));
            
            classItem.sections.forEach(sec => {
                sec.subjects.forEach(sub => {
                    if (sub.subject_type === 'theory' || sub.subject_type === 'both') {
                        classRequired++;
                        if (selectedClassFilter === 'all' || selectedClassFilter === index.toString()) totalRequiredTheory++;
                        if (sub.allocations?.theory) {
                            classAssigned++;
                            if (selectedClassFilter === 'all' || selectedClassFilter === index.toString()) totalAssignedTheory++;
                        }
                    }
                    if (sub.subject_type === 'lab' || sub.subject_type === 'both' || sub.subject_type === 'practical') {
                        classRequired++;
                        if (selectedClassFilter === 'all' || selectedClassFilter === index.toString()) totalRequiredLab++;
                        if (sub.allocations?.lab) {
                            classAssigned++;
                            if (selectedClassFilter === 'all' || selectedClassFilter === index.toString()) totalAssignedLab++;
                        }
                    }
                });
            });

            if (selectedClassFilter === 'all' || selectedClassFilter === index.toString()) {
                totalCourses++;
                totalRequired += classRequired;
                totalAssigned += classAssigned;
            }

            if (classRequired === 0) {
                classStatuses[classItem.class_id] = { status: 'none', required: 0, assigned: 0 };
            } else if (classAssigned === 0) {
                classStatuses[classItem.class_id] = { status: 'not_started', required: classRequired, assigned: classAssigned };
            } else if (classAssigned < classRequired) {
                classStatuses[classItem.class_id] = { status: 'pending', required: classRequired, assigned: classAssigned };
            } else {
                classStatuses[classItem.class_id] = { status: 'done', required: classRequired, assigned: classAssigned };
            }
        });

        return {
            totalCourses,
            totalRequired,
            totalRequiredTheory,
            totalRequiredLab,
            totalAssigned,
            totalAssignedTheory,
            totalAssignedLab,
            totalPending: totalRequired - totalAssigned,
            totalPendingTheory: totalRequiredTheory - totalAssignedTheory,
            totalPendingLab: totalRequiredLab - totalAssignedLab,
            classStatuses
        };
    }, [matrixData, selectedClassFilter]);

    const fetchTeachers = async () => {
        try {
            const teachRes = await api.get(`/allocations/teachers-workload?session_id=${selectedSession}&department_id=${selectedDepartment}`);
            if (teachRes.data.success) {
                setTeachers(teachRes.data.data);
            }
        } catch (error) {
            toast.error('Failed to load teachers');
        }
    };

    const handleClearAllocations = async () => {
        if (!selectedSession || !selectedDepartment) {
            toast.warning('Please select Session and Department first');
            return;
        }

        const result = await Swal.fire({
            title: 'Clear All Allocations?',
            text: `Are you sure you want to unassign all teachers for the selected session and department${selectedClassFilter !== 'all' && selectedClassFilter !== 'all_detailed' ? ' (for this class only)' : ''}? This action cannot be undone.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Yes, clear them!'
        });

        if (result.isConfirmed) {
            try {
                let url = `/allocations/clear/all?session_id=${selectedSession}&department_id=${selectedDepartment}`;
                if (selectedClassFilter !== 'all' && selectedClassFilter !== 'all_detailed') {
                    const cls = matrixData[parseInt(selectedClassFilter)];
                    if (cls) url += `&class_id=${cls.class_id}`;
                }
                
                const res = await api.delete(url);
                if (res.data.success) {
                    Swal.fire('Cleared!', res.data.message, 'success');
                    fetchMatrix();
                }
            } catch (error) {
                Swal.fire('Error', error.response?.data?.message || 'Failed to clear allocations', 'error');
            }
        }
    };

    const handleDownloadTemplate = async () => {
        if (!selectedSession || !selectedDepartment) {
            toast.warning('Please select Session and Department first');
            return;
        }

        try {
            // Step 1: Fetch elective preview info
            const previewRes = await api.get(`/allocations/elective-preview?session_id=${selectedSession}&department_id=${selectedDepartment}`);
            const previewData = previewRes.data;

            // Step 2: Build popup HTML
            let popupHtml = `
                <div style="text-align:left; font-size:14px; line-height:1.6;">
                    <div style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; padding:12px 16px; margin-bottom:14px;">
                        <div style="font-weight:600; color:#0369a1; margin-bottom:4px;">
                            <i class="bi bi-info-circle-fill"></i> &nbsp;About This Template
                        </div>
                        <ul style="margin:0; padding-left:20px; color:#334155; font-size:13px;">
                            <li>The template includes <b>all regular subjects</b> for each class &amp; section.</li>
                            <li>For <b>Elective subjects</b>, only the ones you have <b>selected</b> in the 
                                <b>Classes → Edit → Available Elective Subjects</b> section will appear.</li>
                            <li>If no elective is selected for a class, <b>no elective subject</b> will appear for that class in the template.</li>
                        </ul>
                    </div>`;

            if (previewData.hasElectives && previewData.classes && previewData.classes.length > 0) {
                const withSelected = previewData.classes.filter(c => c.selected_electives.length > 0);
                const withNone = previewData.classes.filter(c => c.selected_electives.length === 0);

                if (withSelected.length > 0) {
                    popupHtml += `<div style="margin-bottom:10px;">
                        <div style="font-weight:600; color:#15803d; margin-bottom:6px;">✅ Classes with Electives Selected (will appear in template):</div>`;
                    withSelected.forEach(cls => {
                        const electiveList = cls.selected_electives.map(e => `<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:12px;font-size:12px;margin:2px;display:inline-block;">${e.name} (${e.code})</span>`).join(' ');
                        popupHtml += `<div style="margin-bottom:6px;padding:6px 10px;background:#f9fafb;border-radius:6px;">
                            <b>${cls.program_name}</b> <span style="color:#6b7280;">Sem ${cls.semester}</span><br/>
                            ${electiveList}
                        </div>`;
                    });
                    popupHtml += `</div>`;
                }

                if (withNone.length > 0) {
                    popupHtml += `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px 14px;">
                        <div style="font-weight:600; color:#c2410c; margin-bottom:6px;">⚠️ Classes with NO Elective Selected (electives will NOT appear in template):</div>`;
                    withNone.forEach(cls => {
                        const notSelectedList = cls.not_selected_electives.map(e => `<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:12px;font-size:12px;margin:2px;display:inline-block;">${e.name} (${e.code})</span>`).join(' ');
                        popupHtml += `<div style="margin-bottom:6px;padding:6px 10px;background:#f9fafb;border-radius:6px;">
                            <b>${cls.program_name}</b> <span style="color:#6b7280;">Sem ${cls.semester}</span><br/>
                            <span style="font-size:12px;color:#6b7280;">Available but not selected: </span>${notSelectedList || '<span style="color:#6b7280;font-size:12px;">None</span>'}
                        </div>`;
                    });
                    popupHtml += `<div style="font-size:12px;color:#9a3412;margin-top:6px;">
                        👉 To fix: Go to <b>Classes → Edit</b> and select the elective subjects under "Available Elective Subjects".
                    </div></div>`;
                }
            } else if (!previewData.hasElectives) {
                popupHtml += `<div style="color:#6b7280; font-size:13px;">
                    ℹ️ No elective subjects found for this department — all subjects will appear normally.
                </div>`;
            }

            popupHtml += `</div>`;

            // Step 3: Show popup
            const result = await Swal.fire({
                title: '📥 Download Allocation Template',
                html: popupHtml,
                icon: 'info',
                showDenyButton: true,
                showCancelButton: true,
                confirmButtonText: '<i class="bi bi-person-check-fill me-1"></i> With Assigned Teachers',
                denyButtonText: '<i class="bi bi-person-dash me-1"></i> Without Assigned Teachers',
                cancelButtonText: 'Cancel',
                customClass: {
                    popup: 'rounded-4 shadow-lg',
                    title: 'fs-5 fw-bold',
                    confirmButton: 'btn btn-primary rounded-pill px-3 m-1',
                    denyButton: 'btn btn-outline-secondary rounded-pill px-3 m-1',
                    cancelButton: 'btn btn-light border rounded-pill px-3 m-1'
                },
                buttonsStyling: false,
                width: 600
            });

            if (!result.isConfirmed && !result.isDenied) return;
            
            const includeAssigned = result.isConfirmed ? 'true' : 'false';

            // Step 4: Do the actual download
            const response = await api.get(`/allocations/bulk-template?session_id=${selectedSession}&department_id=${selectedDepartment}&include_assigned=${includeAssigned}`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'allocations_template.csv');
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (error) {
            toast.error('Failed to download template');
        }
    };


    const handleBulkUploadClick = async () => {
        if (!selectedSession || !selectedDepartment) {
            toast.warning('Please select Session and Department first');
            return;
        }

        const { value: fileData } = await Swal.fire({
            title: 'Upload Allocations CSV',
            html: `
                <div style="text-align: left; font-size: 14px; margin-bottom: 15px;">
                    <div class="alert alert-info py-2 px-3 mb-3 small" style="border-radius: 8px;">
                        <i class="bi bi-info-circle-fill me-1"></i>
                        <b>Note:</b> To mark a <b>Class Teacher</b> or set <b>Online conduct mode</b>, please edit manually in table after upload.
                    </div>
                    <p class="mb-2 text-dark">Please upload your filled template CSV/Excel file. Keep these rules in mind:</p>
                    <ul class="text-muted small ps-3 mb-0" style="line-height: 1.6;">
                        <li><b>Do not modify</b> the first 7 columns (Class, Semester, Section, Subject Code, Subject Name, Credits, Allocation Type).</li>
                        <li><b>Teacher Matching:</b> You can fill <b>Teacher Name</b> or <b>Teacher Employee ID</b> (or both). If both are filled and Name has a spelling mistake, the system will prioritize matching by <b>Employee ID</b>.</li>
                        <li>If a teacher is not found, or if you modify the pre-filled columns, those specific rows will fail and be skipped.</li>
                        <li>Missing/Skipped rows will be shown to you after the upload finishes.</li>
                    </ul>
                </div>
            `,
            input: 'file',
            inputAttributes: {
                'accept': '.csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel',
                'aria-label': 'Upload your CSV file'
            },
            customClass: {
                popup: 'rounded-4 shadow-lg',
                title: 'fs-5 fw-bold',
                confirmButton: 'btn btn-primary rounded-pill px-4',
                cancelButton: 'btn btn-light border rounded-pill px-4'
            },
            showCancelButton: true,
            confirmButtonText: '<i class="bi bi-upload me-2"></i> Upload File',
            showLoaderOnConfirm: true,
            preConfirm: async (file) => {
                if (!file) {
                    Swal.showValidationMessage('Please select a file first');
                    return false;
                }

                const formData = new FormData();
                formData.append('file', file);
                formData.append('session_id', selectedSession);
                formData.append('department_id', selectedDepartment);

                try {
                    const res = await api.post('/allocations/bulk-upload', formData, {
                        headers: { 'Content-Type': 'multipart/form-data' }
                    });
                    return res.data;
                } catch (error) {
                    Swal.showValidationMessage(error.response?.data?.message || 'Failed to upload CSV');
                    return false;
                }
            },
            allowOutsideClick: () => !Swal.isLoading()
        });

        if (fileData) {
            if (fileData.success) {
                if (fileData.errors && fileData.errors.length > 0) {
                    // Extract unique missing teachers from errors
                    const missingTeachers = [...new Set(
                        fileData.errors
                            .filter(e => e.includes('not found'))
                            .map(e => {
                                const m = e.match(/Teacher '([^']+)'/);
                                return m ? m[1].split('(')[0].trim() : null;
                            })
                            .filter(Boolean)
                    )];

                    const errorsHtml = fileData.errors.length > 0 
                        ? `<div style="max-height:160px;overflow-y:auto;text-align:left;font-size:12px;background:#f8f9fa;padding:10px;border-radius:5px;border:1px solid #dee2e6;margin-top:8px">${fileData.errors.join('<br/>')}</div>`
                        : '';

                    const missingHtml = missingTeachers.length > 0
                        ? `<div style="text-align:left;margin-top:10px"><b>👤 Teachers not found in database (${missingTeachers.length}):</b><div style="max-height:100px;overflow-y:auto;font-size:12px;background:#fff3cd;padding:8px;border-radius:5px;margin-top:4px">${missingTeachers.map(t=>`• ${t}`).join('<br/>')}</div><small class="text-muted">Please add these teachers in the Teachers section first, then re-upload.</small></div>`
                        : '';

                    Swal.fire({
                        title: 'Upload Partially Successful',
                        html: `<div style="white-space:pre-line"><b>${fileData.message}</b></div>${missingHtml}${errorsHtml}`,
                        icon: 'warning',
                        width: 600
                    });
                } else {
                    Swal.fire({
                        title: 'Success!',
                        html: `<div style="white-space:pre-line">${fileData.message}</div>`,
                        icon: 'success'
                    });
                }
                fetchMatrix(false);
            }
        }
    };

    const openWorkloadModal = async () => {
        if (!selectedSession || !selectedDepartment) {
            toast.warning('Please select Session and Department first');
            return;
        }
        await fetchTeachers();
        setViewTeacherAllocations(null);
        setShowWorkloadModal(true);
    };

    const fetchTeacherAllocations = async (teacher) => {
        try {
            const res = await api.get(`/allocations?teacher_id=${teacher.id}&session_id=${selectedSession}`);
            if (res.data.success) {
                setTeacherAllocationsData(res.data.data);
                setViewTeacherAllocations(teacher);
            }
        } catch (error) {
            toast.error('Failed to load allocations for teacher');
        }
    };

    const sortedWorkloadTeachers = useMemo(() => {
        return [...teachers].sort((a, b) => {
            const theoryA = parseInt(a.total_theory_credits) || 0;
            const theoryB = parseInt(b.total_theory_credits) || 0;
            const labA = parseInt(a.total_lab_credits) || 0;
            const labB = parseInt(b.total_lab_credits) || 0;
            const totalA = theoryA + labA;
            const totalB = theoryB + labB;

            switch (workloadSortBy) {
                case 'total_desc':
                    return totalB - totalA || (a.full_name || '').localeCompare(b.full_name || '');
                case 'total_asc':
                    return totalA - totalB || (a.full_name || '').localeCompare(b.full_name || '');
                case 'theory_desc':
                    return theoryB - theoryA || totalB - totalA || (a.full_name || '').localeCompare(b.full_name || '');
                case 'theory_asc':
                    return theoryA - theoryB || totalA - totalB || (a.full_name || '').localeCompare(b.full_name || '');
                case 'lab_desc':
                    return labB - labA || totalB - totalA || (a.full_name || '').localeCompare(b.full_name || '');
                case 'lab_asc':
                    return labA - labB || totalA - totalB || (a.full_name || '').localeCompare(b.full_name || '');
                case 'name_asc':
                    return (a.full_name || '').localeCompare(b.full_name || '');
                case 'name_desc':
                    return (b.full_name || '').localeCompare(a.full_name || '');
                default:
                    return totalB - totalA;
            }
        });
    }, [teachers, workloadSortBy]);

    const handleWorkloadSort = (col) => {
        if (workloadSortBy === `${col}_desc`) {
            setWorkloadSortBy(`${col}_asc`);
        } else {
            setWorkloadSortBy(`${col}_desc`);
        }
    };

    const openAddModal = async (section, subject, allocType, classItem) => {
        setActiveSection(section);
        setActiveSubject(subject);
        setActiveAllocType(allocType);
        setActiveClassItem(classItem);
        
        await fetchTeachers();
        
        setModalMode('add');
        setEditItem(null);
        reset({ teacher_id: '', is_class_teacher: false, is_online: false, conduct_in_teacher_dept: false });
        setShowModal(true);
    };

    const openEditModal = async (allocation, section, subject, allocType, classItem) => {
        setActiveSection(section);
        setActiveSubject(subject);
        setActiveAllocType(allocType);
        setActiveClassItem(classItem);
        
        await fetchTeachers();
        
        const isClassTeacher = classItem.class_teacher_id === allocation.teacher_id;
        
        setModalMode('edit');
        setEditItem(allocation);
        reset({ 
            teacher_id: allocation.teacher_id, 
            is_class_teacher: isClassTeacher, 
            is_online: Number(allocation.is_online) === 1,
            conduct_in_teacher_dept: Number(allocation.conduct_in_teacher_dept) === 1
        });
        setShowModal(true);
    };

    const handleToggleOnline = async (id, currentStatus) => {
        try {
            const newStatus = currentStatus === 1 ? 0 : 1;
            const res = await api.patch(`/allocations/${id}/toggle-online`, { is_online: newStatus });
            if (res.data.success) {
                showSuccess(`Online status ${newStatus ? 'enabled' : 'disabled'}`);
                fetchMatrix(false, true);
            }
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to toggle online status');
        }
    };

    const onSubmit = async (data) => {
        try {
            const selectedTeacherId = parseInt(data.teacher_id);
            const isMarkingAsClassTeacher = data.is_class_teacher || false;
            const isOnlineSubject = data.is_online || false;
            const isConductInTeacherDept = data.conduct_in_teacher_dept || false;

            // Check if they are marking as class teacher and someone else is already the class teacher
            if (isMarkingAsClassTeacher && activeClassItem && activeClassItem.class_teacher_id && activeClassItem.class_teacher_id !== selectedTeacherId) {
                const confirm = await Swal.fire({
                    title: 'Overwrite Class Teacher?',
                    text: `${activeClassItem.class_teacher_name} is already the Class Teacher for this class. Marking this new teacher will replace them. Are you sure?`,
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#0d6efd',
                    cancelButtonColor: '#6c757d',
                    confirmButtonText: 'Yes, Overwrite'
                });

                if (!confirm.isConfirmed) {
                    return; // Abort submission
                }
            }

            if (modalMode === 'add') {
                const payload = {
                    section_id: activeSection.section_id,
                    subject_id: activeSubject.id,
                    teacher_id: selectedTeacherId,
                    allocation_type: activeAllocType,
                    is_class_teacher: isMarkingAsClassTeacher,
                    is_online: isOnlineSubject ? 1 : 0,
                    conduct_in_teacher_dept: isConductInTeacherDept ? 1 : 0
                };
                await api.post('/allocations', payload);
                showSuccess('Teacher assigned successfully');
            } else {
                await api.put(`/allocations/${editItem.allocation_id}`, { 
                    teacher_id: selectedTeacherId,
                    is_class_teacher: isMarkingAsClassTeacher,
                    is_online: isOnlineSubject ? 1 : 0,
                    conduct_in_teacher_dept: isConductInTeacherDept ? 1 : 0
                });
                showSuccess('Assignment updated');
            }
            setShowModal(false);
            fetchMatrix(false, true);
        } catch (error) {
            toast.error(error.response?.data?.message || 'Operation failed');
        }
    };

    const handleDelete = (id) => {
        safeDelete('this allocation', async () => {
            try {
                await api.delete(`/allocations/${id}`);
                showSuccess('Allocation deleted successfully');
                fetchMatrix(false, true);
            } catch (error) {
                toast.error(error.response?.data?.message || 'Failed to delete');
            }
        });
    };

    const exportToExcel = () => {
        const dataToExport = sortedWorkloadTeachers.map(t => ({
            'Teacher Name': t.full_name,
            'Designation': t.designation || '',
            'Employee Code': t.employee_code || t.short_name,
            'Department': t.department_name || '',
            'Theory Credits': parseInt(t.total_theory_credits) || 0,
            'Lab Credits (Count)': parseInt(t.total_lab_credits) || 0,
            'Total Credits': (parseInt(t.total_theory_credits) || 0) + (parseInt(t.total_lab_credits) || 0)
        }));

        const worksheet = XLSX.utils.json_to_sheet(dataToExport);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Teacher Workload');
        XLSX.writeFile(workbook, `Teacher_Workload_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    const customStyles = `
        .btn-outline-dashed {
            border: 1px dashed var(--border-color);
            background: transparent;
            transition: all 0.2s ease;
        }
        .btn-outline-dashed:hover {
            border-color: var(--primary);
            color: var(--primary) !important;
            background: var(--primary-50);
        }
        .table-matrix th, .table-matrix td {
            vertical-align: middle;
        }
    `;

    return (
        <div>
            <style>{customStyles}</style>
            <PageHeader 
                title="Allocations Matrix" 
                subtitle="Manage and view teacher subject assignments department-wise" 
                icon="bi-journal-check"
                actionButton={{ label: "Teacher Workload", icon: "bi-person-lines-fill", onClick: openWorkloadModal }} 
            />

            {/* Global Filters */}
            <div className="card border-0 shadow-sm rounded-4 mb-4">
                <div className="card-body p-4">
                    <div className="row g-3 align-items-end">
                        {!isDeptAdmin && (
                            <div className="col-md-6 col-lg-2">
                                <label className="form-label fw-bold text-dark small">Department</label>
                                <select 
                                    className="form-select border-0 bg-light"
                                    value={selectedDepartment}
                                    onChange={(e) => setSelectedDepartment(e.target.value)}
                                >
                                    <option value="">Select Department...</option>
                                    {departments.map(d => (
                                        <option key={d.id} value={d.id}>{d.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div className="col-md-6 col-lg-2">
                            <label className="form-label fw-bold text-dark small">Academic Session</label>
                            <select 
                                className="form-select border-0 bg-light"
                                value={selectedSession}
                                onChange={(e) => setSelectedSession(e.target.value)}
                            >
                                <option value="">Select Session...</option>
                                {sessions.map(s => (
                                    <option key={s.id} value={s.id}>{s.name} {s.is_active ? '(Active)' : ''}</option>
                                ))}
                            </select>
                        </div>
                        <div className="col-md-12 col-lg-4">
                            <label className="form-label fw-bold text-dark small">Class / Course</label>
                            <select 
                                className="form-select border-0 bg-light"
                                value={selectedClassFilter}
                                onChange={(e) => {
                                    setSelectedClassFilter(e.target.value);
                                    if(e.target.value !== 'all' && e.target.value !== 'all_detailed') setCurrentClassIndex(parseInt(e.target.value));
                                }}
                            >
                                <option value="all">All Classes (Combined Stats)</option>
                                <option value="all_detailed">All Classes (Detailed Matrix)</option>
                                {matrixData.map((c, i) => (
                                    <option key={c.class_id} value={i}>{c.program_name} (Sem {c.semester})</option>
                                ))}
                            </select>
                        </div>
                        <div className="col-md-6 col-lg-2">
                            <label className="form-label fw-bold text-dark small">Subject Type</label>
                            <select 
                                className="form-select border-0 bg-light"
                                value={allocationFilter}
                                onChange={(e) => setAllocationFilter(e.target.value)}
                            >
                                <option value="all">All</option>
                                <option value="theory">Theory Only</option>
                                <option value="lab">Lab Only</option>
                            </select>
                        </div>
                        <div className="col-md-6 col-lg-2">
                            <label className="form-label fw-bold text-dark small">Status</label>
                            <select 
                                className="form-select border-0 bg-light"
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                            >
                                <option value="all">All</option>
                                <option value="pending">Pending</option>
                                <option value="assigned">Assigned</option>
                            </select>
                        </div>
                        <div className="col-12 mt-3 pt-3 border-top">
                            <div className="row g-2 justify-content-sm-end">
                                <div className="col-4 col-sm-auto">
                                    <button 
                                        className="btn btn-outline-danger btn-sm rounded-pill w-100 d-flex align-items-center justify-content-center gap-1" 
                                        onClick={handleClearAllocations}
                                        disabled={!selectedDepartment || !selectedSession}
                                    >
                                        <i className="bi bi-trash3"></i>
                                        <span className="d-none d-sm-inline">Clear Allocations</span>
                                        <span className="d-inline d-sm-none">Clear</span>
                                    </button>
                                </div>
                                <div className="col-4 col-sm-auto">
                                    <button 
                                        className="btn btn-outline-primary btn-sm rounded-pill w-100 d-flex align-items-center justify-content-center gap-1" 
                                        onClick={handleDownloadTemplate}
                                        disabled={!selectedDepartment || !selectedSession}
                                    >
                                        <i className="bi bi-download"></i>
                                        <span className="d-none d-sm-inline">Download Template</span>
                                        <span className="d-inline d-sm-none">Template</span>
                                    </button>
                                </div>
                                <div className="col-4 col-sm-auto">
                                    <button 
                                        className="btn btn-outline-success btn-sm rounded-pill w-100 d-flex align-items-center justify-content-center gap-1" 
                                        onClick={handleBulkUploadClick} 
                                        disabled={uploading || !selectedDepartment || !selectedSession}
                                    >
                                        {uploading ? <span className="spinner-border spinner-border-sm"></span> : <i className="bi bi-upload"></i>}
                                        <span className="d-none d-sm-inline">{uploading ? 'Uploading...' : 'Bulk Upload'}</span>
                                        <span className="d-inline d-sm-none">{uploading ? '...' : 'Upload'}</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Overview Stats */}
            {!loading && matrixData.length > 0 && (
                <div className="row g-3 mb-4">
                    <div className="col-6 col-md-3">
                        <div className="card border-0 shadow-sm rounded-4 bg-primary text-white h-100">
                            <div className="card-body p-3 p-md-4 d-flex align-items-center">
                                <div className="display-6 me-2 me-md-3 opacity-75"><i className="bi bi-book"></i></div>
                                <div>
                                    <div className="small opacity-75 mb-1">Total Courses</div>
                                    <div className="fs-4 fs-md-3 fw-bold">{stats.totalCourses}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="col-6 col-md-3">
                        <div className="card border-0 shadow-sm rounded-4 bg-info text-white h-100">
                            <div className="card-body p-3 p-md-4 d-flex align-items-center">
                                <div className="display-6 me-2 me-md-3 opacity-75"><i className="bi bi-list-task"></i></div>
                                <div>
                                    <div className="small opacity-75 mb-1">Required Subjects</div>
                                    <div className="fs-4 fs-md-3 fw-bold mb-1">{stats.totalRequired}</div>
                                    <div className="small fw-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>Theory: {stats.totalRequiredTheory} | Lab: {stats.totalRequiredLab}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="col-6 col-md-3">
                        <div className="card border-0 shadow-sm rounded-4 bg-success text-white h-100">
                            <div className="card-body p-3 p-md-4 d-flex align-items-center">
                                <div className="display-6 me-2 me-md-3 opacity-75"><i className="bi bi-check-circle"></i></div>
                                <div>
                                    <div className="small opacity-75 mb-1">Assigned Subjects</div>
                                    <div className="fs-4 fs-md-3 fw-bold mb-1">{stats.totalAssigned}</div>
                                    <div className="small fw-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>Theory: {stats.totalAssignedTheory} | Lab: {stats.totalAssignedLab}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="col-6 col-md-3">
                        <div className="card border-0 shadow-sm rounded-4 bg-warning text-dark h-100">
                            <div className="card-body p-3 p-md-4 d-flex align-items-center">
                                <div className="display-6 me-2 me-md-3 opacity-75"><i className="bi bi-hourglass-split"></i></div>
                                <div>
                                    <div className="small opacity-75 mb-1">Pending Subjects</div>
                                    <div className="fs-4 fs-md-3 fw-bold mb-1">{stats.totalPending}</div>
                                    <div className="small fw-semibold" style={{ color: 'rgba(0,0,0,0.6)' }}>Theory: {stats.totalPendingTheory} | Lab: {stats.totalPendingLab}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Pagination Controls */}
            {!loading && matrixData.length > 0 && selectedClassFilter !== 'all' && selectedClassFilter !== 'all_detailed' && (
                <div className="card border-0 shadow-sm rounded-4 mb-4 bg-white">
                    <div className="card-body p-3 p-md-4">
                        <div className="d-flex flex-column flex-lg-row align-items-center justify-content-between gap-3">
                            {/* Left: Previous Course button */}
                            <div className="d-flex w-100 w-lg-auto justify-content-start order-2 order-lg-1">
                                <button 
                                    type="button"
                                    className="btn btn-outline-primary btn-sm rounded-pill px-3 py-1 fw-semibold d-flex align-items-center justify-content-center w-100 w-lg-auto shadow-sm"
                                    onClick={() => {
                                        setCurrentClassIndex(prev => {
                                            const nextIdx = prev - 1;
                                            setSelectedClassFilter(nextIdx.toString());
                                            return nextIdx;
                                        });
                                    }} 
                                    disabled={currentClassIndex === 0}
                                    style={{ minWidth: '135px', fontSize: '0.85rem' }}
                                >
                                    <i className="bi bi-arrow-left me-1"></i> Previous Course
                                </button>
                            </div>

                            {/* Center: Course Name & Semester Badge */}
                            <div className="bg-primary bg-opacity-10 px-4 py-2 rounded-pill border border-primary border-opacity-25 d-flex align-items-center justify-content-center gap-2 flex-wrap text-center order-1 order-lg-2 w-100 w-lg-auto shadow-sm">
                                <i className="bi bi-mortarboard-fill text-primary fs-5"></i>
                                <span className="fw-bold text-dark fs-6 text-nowrap">
                                    {matrixData[currentClassIndex].program_name}
                                </span>
                                <span className="badge bg-primary rounded-pill px-3 py-1">
                                    Semester {matrixData[currentClassIndex].semester}
                                </span>
                                <span className="badge bg-white text-dark border rounded-pill px-2 py-1 small">
                                    {currentClassIndex + 1} of {matrixData.length}
                                </span>
                            </div>

                            {/* Right: All Classes Status & Next Course buttons */}
                            <div className="d-flex flex-column flex-sm-row align-items-center justify-content-end gap-2 order-3 order-lg-3 w-100 w-lg-auto">
                                <button 
                                    type="button"
                                    className="btn btn-outline-secondary btn-sm rounded-pill px-3 py-1 fw-semibold d-flex align-items-center justify-content-center text-nowrap w-100 w-sm-auto shadow-sm bg-light border-secondary border-opacity-25"
                                    onClick={() => setSelectedClassFilter('all')}
                                    style={{ fontSize: '0.85rem' }}
                                >
                                    <i className="bi bi-grid-fill me-1"></i> All Classes Status
                                </button>
                                <button 
                                    type="button"
                                    className="btn btn-primary btn-sm rounded-pill px-3 py-1 fw-semibold d-flex align-items-center justify-content-center text-nowrap w-100 w-sm-auto shadow-sm"
                                    onClick={() => {
                                        setCurrentClassIndex(prev => {
                                            const nextIdx = prev + 1;
                                            setSelectedClassFilter(nextIdx.toString());
                                            return nextIdx;
                                        });
                                    }} 
                                    disabled={currentClassIndex === matrixData.length - 1}
                                    style={{ minWidth: '135px', fontSize: '0.85rem' }}
                                >
                                    Next Course <i className="bi bi-arrow-right ms-1"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Matrix View */}
            {loading ? (
                <div className="text-center py-5">
                    <div className="spinner-border text-primary" role="status">
                        <span className="visually-hidden">Loading...</span>
                    </div>
                </div>
            ) : matrixData.length === 0 ? (
                <div className="card border-0 shadow-sm rounded-4">
                    <div className="card-body p-5 text-center">
                        <i className="bi bi-folder-x text-muted mb-3" style={{ fontSize: '3rem' }}></i>
                        <h5 className="text-dark fw-bold">No Data Found</h5>
                        <p className="text-muted mb-0">No classes or sections found for the selected department and session.</p>
                    </div>
                </div>
            ) : matrixData.length > 0 ? (() => {
                const classesToRender = (selectedClassFilter === 'all' || selectedClassFilter === 'all_detailed') 
                    ? matrixData 
                    : [matrixData[currentClassIndex]];
                
                return classesToRender.map(classItem => {
                    if (!classItem) return null;
                    const sections = classItem.sections;
                    
                    // Get unique subjects across all sections
                    const uniqueSubjects = [];
                    sections.forEach(sec => sec.subjects.forEach(sub => {
                        if (!uniqueSubjects.find(s => s.id === sub.id)) {
                            uniqueSubjects.push(sub);
                        }
                    }));
                    
                    if (statusFilter !== 'all') {
                        let hasAnyVisible = false;
                        for (const subject of uniqueSubjects) {
                            const hasTheory = parseFloat(subject.l_credit || 0) > 0 || parseFloat(subject.t_credit || 0) > 0 || subject.subject_type === 'theory' || subject.subject_type === 'both';
                            const hasLab = parseFloat(subject.p_credit || 0) > 0 || subject.subject_type === 'lab' || subject.subject_type === 'both' || subject.subject_type === 'practical';
                            
                            const checkAllocType = (allocType) => {
                                if (allocationFilter !== 'all' && allocationFilter !== allocType) return false;
                                const isFullyAssigned = sections.every(sec => {
                                    const secSub = sec.subjects.find(s => s.id === subject.id);
                                    if (!secSub) return true;
                                    return secSub.allocations?.[allocType];
                                });
                                if (statusFilter === 'pending' && isFullyAssigned) return false;
                                if (statusFilter === 'assigned' && !isFullyAssigned) return false;
                                return true;
                            };
                            
                            if (hasTheory && checkAllocType('theory')) hasAnyVisible = true;
                            if (hasLab && checkAllocType('lab')) hasAnyVisible = true;
                            if (hasAnyVisible) break;
                        }
                        
                        if (!hasAnyVisible) return null;
                    }

                const status = stats.classStatuses[classItem.class_id];

                return (
                    <div className="card shadow-sm border-0 mb-4 rounded-4 overflow-hidden" key={classItem.class_id}>
                        <div className="card-header bg-white py-3 border-bottom d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
                            <div className="d-flex align-items-center">
                                <div className="d-flex align-items-center justify-content-center bg-primary bg-opacity-10 text-primary rounded-3 me-3" style={{ width: '40px', height: '40px' }}>
                                    <i className="bi bi-mortarboard-fill fs-5"></i>
                                </div>
                                <div>
                                    <h5 className="mb-0 fw-bold text-dark">{classItem.program_name} <span className="text-muted fw-normal ms-2">Semester {classItem.semester}</span></h5>
                                    {classItem.class_teacher_name && (
                                        <div className="small text-primary fw-semibold mt-1">
                                            <i className="bi bi-person-badge me-1"></i> Class Teacher: {classItem.class_teacher_name}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="d-flex">
                                {status === 'done' && <span className="badge bg-success px-3 py-2 rounded-pill"><i className="bi bi-check-circle-fill me-1"></i> All Assigned - Done</span>}
                                {status === 'pending' && <span className="badge bg-warning text-dark px-3 py-2 rounded-pill"><i className="bi bi-hourglass-split me-1"></i> Pending</span>}
                                {status === 'not_started' && <span className="badge bg-danger px-3 py-2 rounded-pill"><i className="bi bi-x-circle-fill me-1"></i> Not Assigned Started</span>}
                                {status === 'none' && <span className="badge bg-secondary px-3 py-2 rounded-pill"><i className="bi bi-dash-circle-fill me-1"></i> No Subjects</span>}
                            </div>
                        </div>
                            <div className="table-responsive">
                                <table className="table table-matrix table-hover mb-0 align-middle">
                                    <thead className="bg-light">
                                        <tr>
                                            <th className="px-4 py-3 border-bottom-0 text-muted" style={{ width: '5%', minWidth: '50px' }}>#</th>
                                            <th className="px-4 py-3 border-bottom-0 text-muted" style={{ width: '25%', minWidth: '250px' }}>Subject</th>
                                            <th className="py-3 border-bottom-0 text-muted" style={{ width: '10%' }}>Type</th>
                                            {sections.map(sec => (
                                                <th key={sec.section_id} className="text-center py-3 border-bottom-0 text-dark fw-bold" style={{ minWidth: '150px' }}>
                                                    Section {sec.section_name}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="border-top-0">
                                        {(() => {
                                            let rowIndex = 1;
                                            return uniqueSubjects.map(subject => {
                                                const renderRow = (allocType) => {
                                                    if (statusFilter !== 'all') {
                                                        const isFullyAssigned = sections.every(sec => {
                                                            const secSub = sec.subjects.find(s => s.id === subject.id);
                                                            if (!secSub) return true;
                                                            return secSub.allocations?.[allocType];
                                                        });
                                                        
                                                        if (statusFilter === 'pending' && isFullyAssigned) return null;
                                                        if (statusFilter === 'assigned' && !isFullyAssigned) return null;
                                                    }
                                                    
                                                    return (
                                                        <tr key={`${subject.id}-${allocType}`} className={subject.is_nptel === 1 ? 'table-danger bg-danger bg-opacity-10' : ''} style={subject.is_nptel === 1 ? { borderLeft: '4px solid #e11d48', backgroundColor: '#fff1f2' } : {}}>
                                                            <td className="px-4 py-3 text-muted fw-semibold">
                                                                {rowIndex++}
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
                                                                    <span className="fw-bold text-dark">{subject.full_name}</span>
                                                                    {subject.is_nptel === 1 && (
                                                                        <span className="badge bg-danger text-white px-2 py-1 rounded-pill shadow-sm" style={{ fontSize: '10px' }}>
                                                                            <i className="bi bi-laptop me-1"></i>NPTEL / SWAYAM
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="d-flex align-items-center gap-2">
                                                                    <span className="badge bg-secondary bg-opacity-10 text-secondary border border-secondary border-opacity-25">{subject.short_code}</span>
                                                                    <span className="text-muted small">
                                                                        <i className="bi bi-star-fill text-warning me-1"></i>
                                                                        {allocType === 'theory' 
                                                                            ? parseFloat(subject.l_credit || 0).toFixed(1)
                                                                            : parseFloat(subject.p_credit || 0).toFixed(1)} Cr
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td>
                                                                <span className={`badge rounded-pill bg-${allocType === 'theory' ? 'primary' : 'info'} bg-opacity-10 text-${allocType === 'theory' ? 'primary' : 'info'} border border-${allocType === 'theory' ? 'primary' : 'info'} border-opacity-25 px-3`}>
                                                                    {allocType === 'theory' ? <i className="bi bi-book me-1"></i> : <i className="bi bi-pc-display me-1"></i>}
                                                                    {allocType.charAt(0).toUpperCase() + allocType.slice(1)}
                                                                </span>
                                                            </td>
                                                            {sections.map(sec => {
                                                                const secSub = sec.subjects.find(s => s.id === subject.id);
                                                                const allocation = secSub?.allocations?.[allocType];
                                                                return (
                                                                    <td key={sec.section_id} className="text-center p-3 border-start">
                                                                        {allocation ? (
                                                                            <div className="d-flex flex-column align-items-center bg-success bg-opacity-10 rounded-3 p-2 border border-success border-opacity-25 position-relative group">
                                                                                <div className="fw-bold text-success small text-truncate w-100 mb-1" title={allocation.teacher_name}>
                                                                                    {allocation.teacher_name}
                                                                                </div>
                                                                                <div className="my-1">
                                                                                    <span 
                                                                                        className={`badge rounded-pill ${Number(allocation.is_online) === 1 ? 'bg-primary text-white shadow-sm' : 'bg-light text-muted border'}`} 
                                                                                        style={{ cursor: 'pointer', fontSize: '11px', transition: 'all 0.2s' }}
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            handleToggleOnline(allocation.allocation_id, Number(allocation.is_online));
                                                                                        }}
                                                                                        title="Click to toggle Online/Offline mode for this subject allocation"
                                                                                    >
                                                                                        <i className={`bi ${Number(allocation.is_online) === 1 ? 'bi-wifi' : 'bi-wifi-off'} me-1`}></i>
                                                                                        {Number(allocation.is_online) === 1 ? 'Online' : 'Offline'}
                                                                                    </span>
                                                                                </div>
                                                                                <div className="d-flex gap-3 mt-1">
                                                                                    <button className="btn btn-sm text-primary p-0 text-decoration-none shadow-none" onClick={() => openEditModal(allocation, sec, subject, allocType, classItem)} title="Edit">
                                                                                        <i className="bi bi-pencil-square"></i>
                                                                                    </button>
                                                                                    <button className="btn btn-sm text-danger p-0 text-decoration-none shadow-none" onClick={() => handleDelete(allocation.allocation_id)} title="Remove">
                                                                                        <i className="bi bi-trash"></i>
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        ) : (
                                                                            <button className="btn btn-sm btn-outline-dashed text-muted rounded-3 w-100 py-2" onClick={() => openAddModal(sec, subject, allocType, classItem)}>
                                                                                <i className="bi bi-plus-circle me-1"></i> Assign
                                                                            </button>
                                                                        )}
                                                                    </td>
                                                                );
                                                            })}
                                                        </tr>
                                                    );
                                                };

                                                const hasTheory = parseFloat(subject.l_credit || 0) > 0 || parseFloat(subject.t_credit || 0) > 0 || subject.subject_type === 'theory' || subject.subject_type === 'both';
                                                const hasLab = parseFloat(subject.p_credit || 0) > 0 || subject.subject_type === 'lab' || subject.subject_type === 'both' || subject.subject_type === 'practical';
                                                
                                                if (hasTheory && hasLab) {
                                                    return (
                                                        <React.Fragment key={subject.id}>
                                                            {(allocationFilter === 'all' || allocationFilter === 'theory') && renderRow('theory')}
                                                            {(allocationFilter === 'all' || allocationFilter === 'lab') && renderRow('lab')}
                                                        </React.Fragment>
                                                    );
                                                } else if (hasLab) {
                                                    if (allocationFilter !== 'all' && allocationFilter !== 'lab') return null;
                                                    return renderRow('lab');
                                                } else {
                                                    if (allocationFilter !== 'all' && allocationFilter !== 'theory') return null;
                                                    return renderRow('theory');
                                                }
                                            });
                                        })()}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    );
                });
            })() : null}

            {/* Class List Status Modal */}
            <div className={`modal fade ${showClassListModal ? 'show d-block' : ''}`} tabIndex="-1" style={{ backgroundColor: showClassListModal ? 'rgba(0,0,0,0.5)' : 'transparent' }}>
                <div className="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
                    <div className="modal-content border-0 shadow-lg rounded-4">
                        <div className="modal-header border-bottom-0 pb-0">
                            <h5 className="modal-title fw-bold text-dark">
                                <i className="bi bi-list-ul me-2 text-primary"></i> All Classes Status
                            </h5>
                            <button type="button" className="btn-close" onClick={() => setShowClassListModal(false)}></button>
                        </div>
                            <div className="modal-body py-4">
                                {(() => {
                                    const groupedBySemester = matrixData.reduce((acc, c, originalIdx) => {
                                        const sem = c.semester;
                                        if (!acc[sem]) acc[sem] = [];
                                        acc[sem].push({ ...c, originalIdx });
                                        return acc;
                                    }, {});
                                    const sortedSemesters = Object.keys(groupedBySemester).sort((a, b) => parseInt(a) - parseInt(b));
                                    
                                    return sortedSemesters.map(sem => (
                                        <div key={sem} className="mb-4">
                                            <h6 className="fw-bold text-primary mb-3 ps-2 border-start border-primary border-4">Semester {sem}</h6>
                                            <div className="list-group list-group-flush border rounded-4 overflow-hidden">
                                                {groupedBySemester[sem].map((c) => {
                                                    const idx = c.originalIdx;
                                                    const classStats = stats.classStatuses[c.class_id];
                                                    const status = classStats?.status;
                                                    return (
                                                        <button 
                                                            key={idx} 
                                                            className={`list-group-item list-group-item-action d-flex align-items-center justify-content-between p-3 ${currentClassIndex === idx ? 'bg-primary bg-opacity-10 border-primary border-start border-4' : ''}`}
                                                            onClick={() => {
                                                                setCurrentClassIndex(idx);
                                                                setShowClassListModal(false);
                                                            }}
                                                        >
                                                            <div>
                                                                <h6 className="mb-1 fw-bold text-dark">{c.program_name}</h6>
                                                                {c.sections && c.sections.length > 0 && <small className="text-muted d-block mt-1">Sections: {c.sections.map(s => s.section_name).join(', ')}</small>}
                                                            </div>
                                                            <div className="d-flex align-items-center gap-4">
                                                                <div className="text-end">
                                                                    <div className="small fw-bold text-dark">{classStats?.assigned || 0} / {classStats?.required || 0}</div>
                                                                    <div className="small text-muted" style={{fontSize: '0.7rem'}}>Subjects Assigned</div>
                                                                </div>
                                                                <div style={{ width: '130px' }} className="text-end">
                                                                    {status === 'done' && <span className="badge bg-success px-2 py-1 rounded-pill w-100"><i className="bi bi-check-circle-fill me-1"></i> Done</span>}
                                                                    {status === 'pending' && <span className="badge bg-warning text-dark px-2 py-1 rounded-pill w-100"><i className="bi bi-hourglass-split me-1"></i> Pending</span>}
                                                                    {status === 'not_started' && <span className="badge bg-danger px-2 py-1 rounded-pill w-100"><i className="bi bi-x-circle-fill me-1"></i> Not Started</span>}
                                                                    {status === 'none' && <span className="badge bg-secondary px-2 py-1 rounded-pill w-100"><i className="bi bi-dash-circle-fill me-1"></i> No Subjects</span>}
                                                                </div>
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ));
                                })()}
                            </div>
                        <div className="modal-footer border-top-0 pt-0">
                            <button type="button" className="btn btn-light rounded-pill px-4" onClick={() => setShowClassListModal(false)}>Close</button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Allocation Modal */}
            <FormModal 
                show={showModal} 
                title={modalMode === 'add' ? 'Assign Teacher' : 'Edit Assignment'} 
                onClose={() => setShowModal(false)}
                onSubmit={handleSubmit(onSubmit)}
                isSubmitting={isSubmitting}
            >
                {activeSubject && activeSection && (
                    <div className="alert alert-primary bg-primary bg-opacity-10 border-0 mb-4 p-3 rounded-3 d-flex align-items-start gap-3">
                        <i className="bi bi-info-circle-fill text-primary fs-4"></i>
                        <div>
                            <div className="fw-bold text-dark mb-1 d-flex align-items-center gap-2 flex-wrap">
                                <span>{activeSubject.full_name} ({activeAllocType === 'theory' ? 'Theory' : 'Lab'})</span>
                                {activeSubject.is_nptel === 1 && (
                                    <span className="badge bg-danger text-white px-2 py-0 rounded-pill" style={{ fontSize: '10px' }}>
                                        <i className="bi bi-laptop me-1"></i>NPTEL / SWAYAM
                                    </span>
                                )}
                            </div>
                            <div className="text-muted small">
                                Section {activeSection.section_name}
                            </div>
                        </div>
                    </div>
                )}
                
                <div className="mb-4">
                    <label className="form-label fw-bold text-dark">Select Teacher <span className="text-danger">*</span></label>
                    <select 
                        className={`form-select bg-light ${errors.teacher_id ? 'is-invalid' : ''}`}
                        {...register('teacher_id', { required: 'Teacher is required' })}
                    >
                        <option value="">Select a teacher...</option>
                        {teachers.map(t => {
                            const isLabFaculty = t.designation?.toLowerCase().includes('lab');
                            let optionColor = '';
                            if (activeAllocType === 'theory') {
                                optionColor = isLabFaculty ? '#999999' : '#0d6efd'; // Gray for lab, Blue for theory
                            } else {
                                optionColor = isLabFaculty ? '#198754' : '#999999'; // Green for lab, Gray for theory
                            }
                            return (
                                <option key={t.id} value={t.id} style={{ color: optionColor, fontWeight: 500 }}>
                                    {t.full_name} ({t.designation || 'Faculty'}) - {(Number(t.total_theory_credits) + Number(t.total_lab_credits)).toFixed(2)} cr assigned
                                </option>
                            );
                        })}
                    </select>
                    {errors.teacher_id && <div className="invalid-feedback">{errors.teacher_id.message}</div>}
                </div>
                
                <div className="form-check mb-2">
                    <input className="form-check-input" type="checkbox" id="is_class_teacher" {...register('is_class_teacher')} />
                    <label className="form-check-label text-dark fw-semibold" htmlFor="is_class_teacher">
                        Mark as Class Teacher
                    </label>
                    <div className="form-text text-muted small">
                        This will set the selected teacher as the main Class Teacher for the entire class. Each class can only have ONE Class Teacher. The latest selection will overwrite any existing Class Teacher. Please be careful.
                    </div>
                </div>

                <div className="form-check mb-2">
                    <input className="form-check-input" type="checkbox" id="is_online" {...register('is_online')} />
                    <label className="form-check-label text-dark fw-semibold" htmlFor="is_online">
                        <i className="bi bi-laptop me-1 text-primary"></i> Conduct Online (Manual Override)
                    </label>
                    <div className="form-text text-muted small">
                        If checked, this subject will be scheduled for this teacher without requiring a physical classroom. Both timetable and allocations will clearly show it as Online.
                    </div>
                </div>

                {(() => {
                    const selectedTeacherId = watch('teacher_id');
                    const selectedTeacher = teachers.find(t => t.id === parseInt(selectedTeacherId));
                    const isCrossDepartment = selectedTeacher && selectedTeacher.department_id !== parseInt(selectedDepartment);
                    
                    if (isCrossDepartment) {
                        return (
                            <div className="form-check mb-2">
                                <input className="form-check-input" type="checkbox" id="conduct_in_teacher_dept" {...register('conduct_in_teacher_dept')} />
                                <label className="form-check-label text-dark fw-semibold" htmlFor="conduct_in_teacher_dept">
                                    <i className="bi bi-building-up me-1 text-info"></i> Conduct in Teacher's Department/Block
                                </label>
                                <div className="form-text text-muted small">
                                    This teacher is from <strong>{selectedTeacher.department_name}</strong>. Check this if you want the students to go to their block for this class.
                                </div>
                            </div>
                        );
                    }
                    return null;
                })()}
            </FormModal>

            {/* Teacher Workload Modal */}
            {showWorkloadModal && (
                <div className="modal fade show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}>
                    <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
                        <div className="modal-content border-0 shadow-lg rounded-4 overflow-hidden">
                            <div className="modal-header border-bottom py-3 px-3 px-md-4">
                                <div className="w-100">
                                    {/* Title row */}
                                    <div className="d-flex justify-content-between align-items-center mb-2">
                                        <h5 className="modal-title fw-bold d-flex align-items-center gap-2 mb-0 fs-6 fs-md-5">
                                            <i className="bi bi-person-lines-fill text-primary"></i>
                                            {viewTeacherAllocations ? `Allocations for ${viewTeacherAllocations.full_name}` : 'Teacher Workload (Credits)'}
                                        </h5>
                                        <button type="button" className="btn-close ms-2" onClick={() => setShowWorkloadModal(false)}></button>
                                    </div>
                                    {/* Controls row - sort + export */}
                                    {!viewTeacherAllocations && (
                                        <div className="d-flex gap-2 flex-wrap">
                                            <div className="input-group input-group-sm flex-grow-1" style={{ minWidth: '150px', maxWidth: '260px' }}>
                                                <span className="input-group-text border-end-0 text-muted">
                                                    <i className="bi bi-sort-down"></i>
                                                </span>
                                                <select 
                                                    className="form-select form-select-sm border-start-0 fw-semibold" 
                                                    value={workloadSortBy}
                                                    onChange={(e) => setWorkloadSortBy(e.target.value)}
                                                >
                                                    <option value="total_desc">Total Credits (High → Low)</option>
                                                    <option value="total_asc">Total Credits (Low → High)</option>
                                                    <option value="theory_desc">Theory (High → Low)</option>
                                                    <option value="theory_asc">Theory (Low → High)</option>
                                                    <option value="lab_desc">Lab (High → Low)</option>
                                                    <option value="lab_asc">Lab (Low → High)</option>
                                                    <option value="name_asc">Name (A → Z)</option>
                                                    <option value="name_desc">Name (Z → A)</option>
                                                </select>
                                            </div>
                                            <button type="button" className="btn btn-sm btn-outline-success rounded-pill px-3" onClick={exportToExcel}>
                                                <i className="bi bi-file-earmark-excel me-1"></i>
                                                <span className="d-none d-sm-inline">Export Excel</span>
                                                <span className="d-inline d-sm-none">Export</span>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="modal-body p-0">
                                {!viewTeacherAllocations ? (
                                    <>
                                {/* Desktop Table View */}
                                <div className="table-responsive d-none d-md-block">
                                    <table className="table table-hover align-middle mb-0">
                                        <thead className="table-light">
                                            <tr>
                                                <th className="px-4 py-3" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleWorkloadSort('name')}>
                                                    Teacher Name {workloadSortBy === 'name_asc' ? <i className="bi bi-sort-alpha-down text-primary ms-1"></i> : workloadSortBy === 'name_desc' ? <i className="bi bi-sort-alpha-up text-primary ms-1"></i> : <i className="bi bi-arrow-down-up text-muted ms-1 opacity-50"></i>}
                                                </th>
                                                <th className="py-3 text-center" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleWorkloadSort('theory')}>
                                                    Theory {workloadSortBy === 'theory_desc' ? <i className="bi bi-sort-down-alt text-primary ms-1"></i> : workloadSortBy === 'theory_asc' ? <i className="bi bi-sort-up text-primary ms-1"></i> : <i className="bi bi-arrow-down-up text-muted ms-1 opacity-50"></i>}
                                                </th>
                                                <th className="py-3 text-center" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleWorkloadSort('lab')}>
                                                    Lab {workloadSortBy === 'lab_desc' ? <i className="bi bi-sort-down-alt text-primary ms-1"></i> : workloadSortBy === 'lab_asc' ? <i className="bi bi-sort-up text-primary ms-1"></i> : <i className="bi bi-arrow-down-up text-muted ms-1 opacity-50"></i>}
                                                </th>
                                                <th className="px-4 py-3 text-center" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleWorkloadSort('total')}>
                                                    Total {workloadSortBy === 'total_desc' ? <i className="bi bi-sort-down-alt text-primary ms-1"></i> : workloadSortBy === 'total_asc' ? <i className="bi bi-sort-up text-primary ms-1"></i> : <i className="bi bi-arrow-down-up text-muted ms-1 opacity-50"></i>}
                                                </th>
                                                <th className="px-4 py-3 text-center">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sortedWorkloadTeachers.map(t => {
                                                const theory = parseInt(t.total_theory_credits) || 0;
                                                const lab = parseInt(t.total_lab_credits) || 0;
                                                const total = theory + lab;
                                                return (
                                                    <tr key={t.id}>
                                                        <td className="px-4 py-3">
                                                            <div className="fw-bold">{t.full_name}</div>
                                                            <div className="text-muted small">{t.designation ? `${t.designation} • ` : ''}{t.employee_code || t.short_name}</div>
                                                        </td>
                                                        <td className="text-center py-3">
                                                            <span className="badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25 px-3 py-2 rounded-pill">{theory}</span>
                                                        </td>
                                                        <td className="text-center py-3">
                                                            <span className="badge bg-info bg-opacity-10 text-info border border-info border-opacity-25 px-3 py-2 rounded-pill">{lab}</span>
                                                        </td>
                                                        <td className="text-center px-4 py-3">
                                                            <span className={`badge ${total > 15 ? 'bg-danger text-white' : 'bg-success text-white'} px-3 py-2 rounded-pill`}>{total}</span>
                                                        </td>
                                                        <td className="text-center px-4 py-3">
                                                            <button className="btn btn-sm btn-light text-primary rounded-pill px-3 fw-semibold border" onClick={() => fetchTeacherAllocations(t)}>
                                                                <i className="bi bi-eye"></i> View
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                            {teachers.length === 0 && (
                                                <tr><td colSpan="5" className="text-center py-5 text-muted">No teachers found.</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                {/* Mobile Card View */}
                                <div className="d-md-none p-2">
                                    {sortedWorkloadTeachers.map(t => {
                                        const theory = parseInt(t.total_theory_credits) || 0;
                                        const lab = parseInt(t.total_lab_credits) || 0;
                                        const total = theory + lab;
                                        return (
                                            <div key={t.id} className="card border-0 shadow-sm mb-2 rounded-3">
                                                <div className="card-body py-3 px-3">
                                                    <div className="d-flex justify-content-between align-items-start mb-2">
                                                        <div>
                                                            <div className="fw-bold">{t.full_name}</div>
                                                            <div className="text-muted small">{t.designation || ''} {t.employee_code ? `• ${t.employee_code}` : ''}</div>
                                                        </div>
                                                        <span className={`badge ${total > 15 ? 'bg-danger' : 'bg-success'} text-white rounded-pill px-3 py-2 fs-6`}>{total}</span>
                                                    </div>
                                                    <div className="d-flex gap-3 align-items-center mb-2">
                                                        <span className="badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25 rounded-pill px-3 py-1">
                                                            Theory: {theory}
                                                        </span>
                                                        <span className="badge bg-info bg-opacity-10 text-info border border-info border-opacity-25 rounded-pill px-3 py-1">
                                                            Lab: {lab}
                                                        </span>
                                                    </div>
                                                    <div className="text-start mt-2">
                                                        <button className="btn btn-sm btn-outline-primary rounded-pill px-4" onClick={() => fetchTeacherAllocations(t)}>
                                                            <i className="bi bi-eye me-1"></i> View Allocations
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {teachers.length === 0 && <p className="text-center text-muted py-4">No teachers found.</p>}
                                </div>
                                <div className="px-4 py-3 bg-white text-muted small border-top">
                                    <i className="bi bi-info-circle me-1"></i> 
                                    <strong>Note:</strong> Workload is calculated precisely based on the subject's Weekly Lectures for theory, and Weekly Practicals for lab allocations.
                                </div>
                                </>
                                ) : (
                                    <div className="p-4 bg-light">
                                        <button className="btn btn-sm btn-outline-secondary mb-3 rounded-pill" onClick={() => setViewTeacherAllocations(null)}>
                                            <i className="bi bi-arrow-left me-1"></i> Back to Workload List
                                        </button>
                                        <div className="row g-3">
                                            {teacherAllocationsData.map(alloc => (
                                                <div className="col-md-6" key={alloc.id}>
                                                    <div className="card shadow-sm border-0 h-100 rounded-3">
                                                        <div className="card-body">
                                                            <div className="d-flex justify-content-between align-items-start mb-2">
                                                                <h6 className="fw-bold text-dark mb-0">{alloc.subject_name}</h6>
                                                                <span className={`badge bg-${alloc.allocation_type === 'theory' ? 'primary' : 'info'} bg-opacity-10 text-${alloc.allocation_type === 'theory' ? 'primary' : 'info'} rounded-pill`}>
                                                                    {alloc.allocation_type.toUpperCase()}
                                                                </span>
                                                            </div>
                                                            <div className="text-muted small mb-2">
                                                                {alloc.subject_code} • {alloc.allocation_type === 'theory' ? alloc.l_credit : alloc.p_credit} Credits
                                                            </div>
                                                            <div className="d-flex align-items-center gap-2 mt-3 p-2 bg-light rounded-3 border">
                                                                <i className="bi bi-mortarboard text-secondary"></i>
                                                                <span className="fw-semibold">{alloc.program_name} Sem {alloc.semester}</span>
                                                                <span className="badge bg-secondary text-white ms-auto">Section {alloc.section_name}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                            {teacherAllocationsData.length === 0 && (
                                                <div className="col-12 text-center py-5 text-muted">
                                                    <i className="bi bi-folder-x fs-1 d-block mb-2"></i>
                                                    No allocations found for this teacher in the selected session.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="modal-footer border-top-0 bg-light p-3">
                                <button type="button" className="btn btn-secondary rounded-pill px-4" onClick={() => setShowWorkloadModal(false)}>Close</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Allocations;
