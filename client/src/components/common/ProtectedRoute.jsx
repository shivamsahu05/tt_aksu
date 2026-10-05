import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const ProtectedRoute = ({ allowedRoles, allowedPermissions, children }) => {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="vh-100 d-flex justify-content-center align-items-center bg-light">
                <div className="spinner-border text-primary" role="status">
                    <span className="visually-hidden">Loading...</span>
                </div>
            </div>
        );
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (!allowedRoles && !allowedPermissions) {
        return children ? children : <Outlet />;
    }

    let hasRoleAccess = false;
    let hasPermAccess = false;

    // Check Roles
    if (allowedRoles && allowedRoles.includes(user.role)) {
        hasRoleAccess = true;
    }

    // Check Permissions
    if (allowedPermissions && user.permissions) {
        hasPermAccess = allowedPermissions.some(perm => user.permissions.includes(perm));
    }

    // Admins implicitly have all permissions
    if (allowedPermissions && ['SUPER_ADMIN', 'DEPARTMENT_ADMIN'].includes(user.role)) {
        hasPermAccess = true;
    }

    const requiresRole = !!allowedRoles;
    const requiresPerm = !!allowedPermissions;

    let granted = false;
    if (requiresRole && requiresPerm) {
        // If both are provided, they either need the exact role OR the specific permission
        // Example: Route allowedRoles={['DEPARTMENT_ADMIN']} allowedPermissions={['manage_subjects']}
        // If they are Dept Admin, hasRoleAccess is true -> granted
        // If they are Faculty with manage_subjects, hasPermAccess is true -> granted
        granted = hasRoleAccess || hasPermAccess;
    } else if (requiresRole) {
        granted = hasRoleAccess;
    } else if (requiresPerm) {
        granted = hasPermAccess;
    }

    if (!granted) {
        return <Navigate to="/dashboard" replace />;
    }

    return children ? children : <Outlet />;
};

export default ProtectedRoute;
