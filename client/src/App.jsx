import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';

import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/common/ProtectedRoute';
import AppShell from './components/layout/AppShell';

// --- Admin Pages ---
const AdminDashboard = React.lazy(() => import('./pages/admin/Dashboard'));
const AdminDepartments = React.lazy(() => import('./pages/admin/Departments'));
const AdminSessions = React.lazy(() => import('./pages/admin/Sessions'));
const AdminTimeSlots = React.lazy(() => import('./pages/admin/TimeSlots'));
const AdminRooms = React.lazy(() => import('./pages/admin/Rooms'));
const AdminSmartRoomAllocator = React.lazy(() => import('./pages/admin/SmartRoomAllocator'));
const AdminTeachers = React.lazy(() => import('./pages/admin/Teachers'));
const AdminSubjects = React.lazy(() => import('./pages/admin/Subjects'));
const AdminClasses = React.lazy(() => import('./pages/admin/Classes'));
const AdminAllocations = React.lazy(() => import('./pages/admin/Allocations'));
const AdminTimetableManager = React.lazy(() => import('./pages/admin/TimetableManager'));
const AdminTimetableReports = React.lazy(() => import('./pages/admin/TimetableReports'));
const AdminDailyTimetable = React.lazy(() => import('./pages/admin/DailyTimetable'));
const AdminTimetableAnalysis = React.lazy(() => import('./pages/admin/TimetableAnalysis'));
const UserManagement = React.lazy(() => import('./pages/admin/UserManagement'));
const AdminLeaveApprovals = React.lazy(() => import('./pages/admin/LeaveApprovals'));
const AdminReplacementManager = React.lazy(() => import('./pages/admin/ReplacementManager'));
const Settings = React.lazy(() => import('./pages/admin/Settings'));
const AuditLogs = React.lazy(() => import('./pages/admin/AuditLogs'));
const InternalTests = React.lazy(() => import('./pages/admin/InternalTests'));
const LibraryAllotments = React.lazy(() => import('./pages/admin/LibraryAllotments'));

// --- Department Admin Pages ---
const DeptDashboard = React.lazy(() => import('./pages/department/Dashboard'));
const DeptTeachers = React.lazy(() => import('./pages/department/Teachers'));
const DeptSubjects = React.lazy(() => import('./pages/department/Subjects'));
const DeptClasses = React.lazy(() => import('./pages/department/Classes'));
const DeptRooms = React.lazy(() => import('./pages/department/Rooms'));
const DeptSmartRoomAllocator = React.lazy(() => import('./pages/department/SmartRoomAllocator'));
const DeptAllocations = React.lazy(() => import('./pages/department/Allocations'));
const DeptTimetableManager = React.lazy(() => import('./pages/department/TimetableManager'));
const DeptTimetableReports = React.lazy(() => import('./pages/department/TimetableReports'));
const DeptDailyTimetable = React.lazy(() => import('./pages/department/DailyTimetable'));
const DeptTimetableAnalysis = React.lazy(() => import('./pages/department/TimetableAnalysis'));
const DeptLeaveApprovals = React.lazy(() => import('./pages/department/LeaveApprovals'));
const DeptReplacementManager = React.lazy(() => import('./pages/department/ReplacementManager'));
const DeptTimeSlots = React.lazy(() => import('./pages/department/TimeSlots'));

// --- Faculty Pages ---
const FacultyDashboard = React.lazy(() => import('./pages/faculty/FacultyDashboard'));
const MyTimetable = React.lazy(() => import('./pages/faculty/MyTimetable'));
const LeaveApplication = React.lazy(() => import('./pages/faculty/LeaveApplication'));

// --- Auth ---
const Login = React.lazy(() => import('./pages/auth/Login'));

// --- Shared Pages ---
const Messages = React.lazy(() => import('./pages/shared/Messages'));

const DashboardRedirect = () => {
    const { user } = useAuth();
    if (!user) return <Navigate to="/login" replace />;
    if (user.role === 'SUPER_ADMIN') return <Navigate to="/admin/dashboard" replace />;
    if (user.role === 'DEPARTMENT_ADMIN') return <Navigate to="/department/dashboard" replace />;
    if (user.role === 'FACULTY') return <Navigate to="/faculty/dashboard" replace />;
    return <Navigate to="/login" replace />;
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <ToastContainer position="top-right" autoClose={3000} theme="colored" />
        <React.Suspense fallback={<div className="vh-100 d-flex justify-content-center align-items-center"><div className="spinner-border text-primary" role="status"></div></div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            
            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                
                <Route path="/dashboard" element={<DashboardRedirect />} />
                
                {/* SUPER_ADMIN Only */}
                <Route element={<ProtectedRoute allowedRoles={['SUPER_ADMIN']} />}>
                  <Route path="/admin/dashboard" element={<AdminDashboard />} />
                  <Route path="/admin/departments" element={<AdminDepartments />} />
                  <Route path="/admin/sessions" element={<AdminSessions />} />
                  <Route path="/admin/timeslots" element={<AdminTimeSlots />} />
                  <Route path="/admin/rooms" element={<AdminRooms />} />
                  <Route path="/admin/room-allocator" element={<AdminSmartRoomAllocator />} />
                  <Route path="/admin/teachers" element={<AdminTeachers />} />
                  <Route path="/admin/subjects" element={<AdminSubjects />} />
                  <Route path="/admin/classes" element={<AdminClasses />} />
                  <Route path="/admin/allocations" element={<AdminAllocations />} />
                  <Route path="/admin/timetable" element={<AdminTimetableManager />} />
                  <Route path="/admin/timetable/reports" element={<AdminTimetableReports />} />
                  <Route path="/admin/timetable/daily" element={<AdminDailyTimetable />} />
                  <Route path="/admin/timetable/analysis" element={<AdminTimetableAnalysis />} />
                  <Route path="/admin/leaves" element={<AdminLeaveApprovals />} />
                  <Route path="/admin/replacements" element={<AdminReplacementManager />} />
                  <Route path="/admin/internal-tests" element={<InternalTests />} />
                  <Route path="/admin/library-allotments" element={<LibraryAllotments />} />
                  
                  <Route path="/admin/users" element={<UserManagement />} />
                  <Route path="/admin/settings" element={<Settings />} />
                  <Route path="/admin/audit" element={<AuditLogs />} />
                  <Route path="/admin/messages" element={<Messages />} />
                </Route>

                {/* DEPARTMENT_ADMIN Only */}
                {/* DEPARTMENT_ADMIN & FACULTY with Permissions */}
                <Route path="/department/dashboard" element={<ProtectedRoute allowedRoles={['DEPARTMENT_ADMIN']}><DeptDashboard /></ProtectedRoute>} />
                <Route path="/department/teachers" element={<ProtectedRoute allowedRoles={['DEPARTMENT_ADMIN']}><DeptTeachers /></ProtectedRoute>} />
                
                <Route path="/department/subjects" element={<ProtectedRoute allowedRoles={['DEPARTMENT_ADMIN']} allowedPermissions={['manage_subjects']}><DeptSubjects /></ProtectedRoute>} />
                <Route path="/department/classes" element={<ProtectedRoute allowedRoles={['DEPARTMENT_ADMIN']} allowedPermissions={['manage_classes']}><DeptClasses /></ProtectedRoute>} />
                <Route path="/department/rooms" element={<ProtectedRoute allowedRoles={['DEPARTMENT_ADMIN']} allowedPermissions={['manage_rooms']}><DeptRooms /></ProtectedRoute>} />
                <Route path="/department/timeslots" element={<ProtectedRoute allowedRoles={['DEPARTMENT_ADMIN']}><DeptTimeSlots /></ProtectedRoute>} />
                
                <Route path="/department/room-allocator" element={<ProtectedRoute allowedRoles={['DEPARTMENT_ADMIN']}><DeptSmartRoomAllocator /></ProtectedRoute>} />
                <Route path="/department/allocations" element={<ProtectedRoute allowedRoles={['DEPARTMENT_ADMIN']}><DeptAllocations /></ProtectedRoute>} />
                <Route path="/department/timetable" element={<ProtectedRoute allowedRoles={['DEPARTMENT_ADMIN']}><DeptTimetableManager /></ProtectedRoute>} />
                <Route path="/department/timetable/reports" element={<ProtectedRoute allowedRoles={['DEPARTMENT_ADMIN']}><DeptTimetableReports /></ProtectedRoute>} />
                <Route path="/department/timetable/daily" element={<ProtectedRoute allowedRoles={['DEPARTMENT_ADMIN']}><DeptDailyTimetable /></ProtectedRoute>} />
                <Route path="/department/timetable/analysis" element={<ProtectedRoute allowedRoles={['DEPARTMENT_ADMIN']}><DeptTimetableAnalysis /></ProtectedRoute>} />
                
                <Route path="/department/leaves" element={<ProtectedRoute allowedRoles={['DEPARTMENT_ADMIN']} allowedPermissions={['manage_leaves']}><DeptLeaveApprovals /></ProtectedRoute>} />
                <Route path="/department/replacements" element={<ProtectedRoute allowedRoles={['DEPARTMENT_ADMIN']}><DeptReplacementManager /></ProtectedRoute>} />
                
                <Route path="/department/internal-tests" element={<ProtectedRoute allowedRoles={['DEPARTMENT_ADMIN']} allowedPermissions={['manage_internal_tests']}><InternalTests /></ProtectedRoute>} />
                <Route path="/department/library-allotments" element={<ProtectedRoute allowedRoles={['DEPARTMENT_ADMIN']}><LibraryAllotments /></ProtectedRoute>} />
                <Route path="/department/users" element={<ProtectedRoute allowedRoles={['DEPARTMENT_ADMIN']}><UserManagement /></ProtectedRoute>} />
                <Route path="/department/messages" element={<ProtectedRoute allowedRoles={['DEPARTMENT_ADMIN']}><Messages /></ProtectedRoute>} />
                
                {/* FACULTY Only */}
                <Route element={<ProtectedRoute allowedRoles={['FACULTY']} />}>
                  <Route path="/faculty/dashboard" element={<FacultyDashboard />} />
                  <Route path="/faculty/timetable" element={<MyTimetable />} />
                  <Route path="/faculty/leaves" element={<LeaveApplication />} />
                  <Route path="/faculty/messages" element={<Messages />} />
                  
                  {/* Delegated Routes */}
                  <Route path="/faculty/subjects" element={<ProtectedRoute allowedPermissions={['manage_subjects']}><DeptSubjects /></ProtectedRoute>} />
                  <Route path="/faculty/classes" element={<ProtectedRoute allowedPermissions={['manage_classes']}><DeptClasses /></ProtectedRoute>} />
                  <Route path="/faculty/rooms" element={<ProtectedRoute allowedPermissions={['manage_rooms']}><DeptRooms /></ProtectedRoute>} />
                  <Route path="/faculty/manage-leaves" element={<ProtectedRoute allowedPermissions={['manage_leaves']}><DeptLeaveApprovals /></ProtectedRoute>} />
                  <Route path="/faculty/internal-tests" element={<ProtectedRoute allowedPermissions={['manage_internal_tests']}><InternalTests /></ProtectedRoute>} />
                </Route>

              </Route>
            </Route>
            
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </React.Suspense>
      </Router>
    </AuthProvider>
  );
}

export default App;

