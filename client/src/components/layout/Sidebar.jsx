import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import logoImg from '../../assets/logo.png';

const menuItems = {
    SUPER_ADMIN: [
        {
            group: null,
            items: [
                { to: '/admin/dashboard', icon: 'bi-speedometer2', label: 'Dashboard' },
            ]
        },
        {
            group: 'Master Data',
            items: [
                { to: '/admin/departments', icon: 'bi-building-fill', label: 'Departments' },
                { to: '/admin/teachers', icon: 'bi-person-badge-fill', label: 'Teachers' },
                { to: '/admin/subjects', icon: 'bi-journal-bookmark-fill', label: 'Subjects' },
                { to: '/admin/classes', icon: 'bi-diagram-3-fill', label: 'Classes & Sections' },
                { to: '/admin/rooms', icon: 'bi-building', label: 'Rooms & Labs' },
                { to: '/admin/sessions', icon: 'bi-calendar-range-fill', label: 'Academic Sessions' },
                { to: '/admin/timeslots', icon: 'bi-clock-fill', label: 'Time Slots' },
            ]
        },
        {
            group: 'Scheduling',
            items: [
                { to: '/admin/allocations', icon: 'bi-person-lines-fill', label: 'Allocations' },
                { to: '/admin/room-allocator', icon: 'bi-magic', label: 'Smart Allocator' },
                { to: '/admin/timetable', icon: 'bi-grid-3x3-gap-fill', label: 'Timetable' },
                { to: '/admin/timetable/daily', icon: 'bi-calendar-day', label: 'Daily Report' },
                { to: '/admin/timetable/reports', icon: 'bi-file-earmark-bar-graph', label: 'Reports' },
                { to: '/admin/timetable/analysis', icon: 'bi-graph-up-arrow', label: 'Deep Analysis' },
            ]
        },
        {
            group: 'Operations',
            items: [
                { to: '/admin/leaves', icon: 'bi-calendar-check-fill', label: 'Leaves' },
                { to: '/admin/replacements', icon: 'bi-people-fill', label: 'Substitutions' },
                { to: '/admin/internal-tests', icon: 'bi-journal-check', label: 'Internal Tests' },
                { to: '/admin/library-allotments', icon: 'bi-book-half', label: 'Library Schedule' },
                { to: '/admin/messages', icon: 'bi-chat-dots-fill', label: 'Messages' },
            ]
        },
        {
            group: 'System',
            items: [
                { to: '/admin/users', icon: 'bi-shield-lock-fill', label: 'Users & Roles' },
                { to: '/admin/audit', icon: 'bi-journal-text', label: 'Audit Logs' },
                { to: '/admin/settings', icon: 'bi-gear-fill', label: 'Settings' },
            ]
        },
    ],
    DEPARTMENT_ADMIN: [
        {
            group: null,
            items: [
                { to: '/department/dashboard', icon: 'bi-speedometer2', label: 'Dashboard' },
            ]
        },
        {
            group: 'Master Data',
            items: [
                { to: '/department/teachers', icon: 'bi-person-badge-fill', label: 'Teachers' },
                { to: '/department/subjects', icon: 'bi-journal-bookmark-fill', label: 'Subjects' },
                { to: '/department/classes', icon: 'bi-diagram-3-fill', label: 'Classes & Sections' },
                { to: '/department/rooms', icon: 'bi-building', label: 'Rooms' },
                { to: '/department/timeslots', icon: 'bi-clock-fill', label: 'Time Slots' },
                { to: '/department/allocations', icon: 'bi-person-video3', label: 'Allocations' },
                { to: '/department/room-allocator', icon: 'bi-magic', label: 'Smart Allocator' },
            ]
        },
        {
            group: 'Scheduling',
            items: [
                { to: '/department/timetable', icon: 'bi-grid-3x3-gap-fill', label: 'Timetable' },
                { to: '/department/timetable/daily', icon: 'bi-calendar-day', label: 'Daily Report' },
                { to: '/department/timetable/reports', icon: 'bi-file-earmark-bar-graph', label: 'Reports' },
                { to: '/department/timetable/analysis', icon: 'bi-graph-up-arrow', label: 'Deep Analysis' },
            ]
        },
        {
            group: 'Operations',
            items: [
                { to: '/department/leaves', icon: 'bi-calendar-check-fill', label: 'Leaves' },
                { to: '/department/replacements', icon: 'bi-people-fill', label: 'Substitutions' },
                { to: '/department/internal-tests', icon: 'bi-journal-check', label: 'Internal Tests' },
                { to: '/department/library-allotments', icon: 'bi-book-half', label: 'Library Schedule' },
                { to: '/department/users', icon: 'bi-shield-lock-fill', label: 'Manage Users' },
                { to: '/department/messages', icon: 'bi-chat-dots-fill', label: 'Messages' },
            ]
        },
    ],
    FACULTY: [
        {
            group: null,
            items: [
                { to: '/faculty/dashboard', icon: 'bi-speedometer2', label: 'My Dashboard' },
                { to: '/faculty/timetable', icon: 'bi-calendar-week-fill', label: 'My Timetable' },
                { to: '/faculty/messages', icon: 'bi-chat-dots-fill', label: 'Messages' }
            ]
        }
    ]
};

const Sidebar = ({ isOpen, setIsOpen, isCollapsed, setIsCollapsed }) => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    const role = user?.role || 'SUPER_ADMIN';
    
    // Copy the menu items for the current role
    let groups = JSON.parse(JSON.stringify(menuItems[role] || menuItems['SUPER_ADMIN']));
    
    // Inject extra menus for FACULTY if they have specific permissions
    if (role === 'FACULTY' && user?.permissions && user.permissions.length > 0) {
        const extraMasterData = [];
        const extraOperations = [];
        
        if (user.permissions.includes('manage_subjects')) {
            extraMasterData.push({ to: '/faculty/subjects', icon: 'bi-journal-bookmark-fill', label: 'Manage Subjects' });
        }
        if (user.permissions.includes('manage_classes')) {
            extraMasterData.push({ to: '/faculty/classes', icon: 'bi-diagram-3-fill', label: 'Manage Classes' });
        }
        if (user.permissions.includes('manage_rooms')) {
            extraMasterData.push({ to: '/faculty/rooms', icon: 'bi-building', label: 'Manage Rooms' });
        }
        
        if (user.permissions.includes('manage_leaves')) {
            extraOperations.push({ to: '/faculty/manage-leaves', icon: 'bi-calendar-check-fill', label: 'Manage Leaves' });
        }
        if (user.permissions.includes('manage_internal_tests')) {
            extraOperations.push({ to: '/faculty/internal-tests', icon: 'bi-journal-check', label: 'Internal Tests' });
        }
        
        if (extraMasterData.length > 0) {
            groups.push({ group: 'Delegated Master Data', items: extraMasterData });
        }
        if (extraOperations.length > 0) {
            groups.push({ group: 'Delegated Operations', items: extraOperations });
        }
    }

    const initials = user?.username ? user.username.slice(0, 2).toUpperCase() : 'AD';

    return (
        <div className={`sidebar ${isOpen ? 'show' : ''} ${isCollapsed ? 'collapsed' : ''}`}>
            {/* Logo */}
            <div className={`sidebar-logo d-flex align-items-center justify-content-start w-100`} style={{ padding: '20px 16px', minHeight: 'var(--navbar-height)', borderBottom: '1px solid var(--app-border-2)', position: 'relative' }}>
                <div className="d-flex align-items-center gap-2" style={{ overflow: 'hidden' }}>
                    <div className="sidebar-logo-icon" style={{ width: '34px', height: '34px', background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '17px', flexShrink: 0, boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)' }}>
                        <img src={logoImg} alt="AKS Logo" style={{ width: '100%', height: '100%' }} />
                    </div>
                    {!isCollapsed && (
                        <div style={{ minWidth: 0 }}>
                            <div className="sidebar-logo-text" style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: '16px', color: 'var(--text-primary)', whiteSpace: 'nowrap', letterSpacing: '-0.3px' }}>AKS TTMS</div>
                            <div className="sidebar-logo-sub" style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 400, whiteSpace: 'nowrap', lineHeight: 1, marginTop: '1px' }}>
                                {role === 'FACULTY' ? 'Faculty Portal' : (role === 'DEPARTMENT_ADMIN' ? 'HOD Console' : 'Admin Console')}
                            </div>
                        </div>
                    )}
                </div>
                <button
                    className="btn btn-sm d-none d-md-flex align-items-center justify-content-center"
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
                    style={{
                        position: 'absolute',
                        right: '-14px',
                        top: '25px',
                        width: '28px',
                        height: '28px',
                        padding: 0,
                        borderRadius: '50%',
                        background: 'var(--app-surface)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--app-border)',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.08)',
                        zIndex: 10
                    }}
                >
                    <i className={`bi ${isCollapsed ? 'bi-chevron-right' : 'bi-chevron-left'}`} style={{ fontSize: '12px', strokeWidth: '1px' }}></i>
                </button>
            </div>

            {/* Navigation */}
            <nav className="sidebar-nav" onClick={e => { if (e.target.closest('a')) setIsOpen(false); }}>
                {groups.map((group, gIdx) => (
                    <div key={gIdx}>
                        {group.group && !isCollapsed && (
                            <div className="sidebar-section-label">{group.group}</div>
                        )}
                        {group.items.map(item => (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                end
                                className={({ isActive }) =>
                                    `nav-item-link ${isActive ? 'active' : ''}`
                                }
                                title={isCollapsed ? item.label : undefined}
                                style={{ justifyContent: isCollapsed ? 'center' : 'flex-start', padding: isCollapsed ? '10px 0' : '8px 12px' }}
                            >
                                <i className={`bi ${item.icon} nav-icon`} style={{ margin: isCollapsed ? '0' : undefined, fontSize: isCollapsed ? '18px' : undefined }} />
                                {!isCollapsed && <span>{item.label}</span>}
                            </NavLink>
                        ))}
                    </div>
                ))}
            </nav>

            {/* User section */}
            <div className="sidebar-user">
                <div className="sidebar-user-btn" style={{ display: 'flex', alignItems: 'center', justifyContent: isCollapsed ? 'center' : 'flex-start', width: '100%', background: 'transparent', border: 'none', padding: isCollapsed ? '8px 0' : '8px 12px', gap: '12px' }}>
                    <div className="sidebar-avatar">{initials}</div>
                    {!isCollapsed && (
                        <div className="sidebar-user-info" style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                            <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {user?.username || 'Admin'}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                                {role}
                            </div>
                        </div>
                    )}
                    {!isCollapsed && (
                        <button
                            onClick={handleLogout}
                            style={{ background: 'transparent', border: 'none', padding: '4px', cursor: 'pointer', display: 'flex' }}
                            title="Logout"
                        >
                            <i className="bi bi-box-arrow-right" style={{ fontSize: '16px', color: 'var(--danger)' }} />
                        </button>
                    )}
                </div>
            </div>

            <div style={{ textAlign: 'center', padding: isCollapsed ? '12px 4px' : '12px', fontSize: '11px', color: 'var(--text-muted)', borderTop: '1px solid var(--app-border)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                {isCollapsed ? (
                    <a href="https://hackvitrasec.com/" target="_blank" rel="noopener noreferrer" title="Powered by HackVitraSec" style={{ fontWeight: '600', color: 'var(--primary)', textDecoration: 'none' }}>
                        HVS
                    </a>
                ) : (
                    <span>Powered by <a href="https://hackvitrasec.com/" target="_blank" rel="noopener noreferrer" style={{ fontWeight: '600', color: 'var(--primary)', textDecoration: 'none' }}>HackVitraSec</a></span>
                )}
            </div>
        </div>
    );
};

export default Sidebar;
