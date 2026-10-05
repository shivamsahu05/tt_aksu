import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../../utils/api';

const routeLabels = {
    '/dashboard': 'Dashboard',
    '/departments': 'Departments',
    '/teachers': 'Teachers',
    '/subjects': 'Subjects',
    '/classes': 'Classes & Sections',
    '/rooms': 'Rooms & Labs',
    '/room-allocator': 'Smart Room Allocator',
    '/sessions': 'Academic Sessions',
    '/timeslots': 'Time Slots',
    '/allocations': 'Allocations',
    '/timetable': 'Timetable Manager',
    '/timetable/reports': 'Timetable Reports',
    '/timetable/daily': 'Daily Timetable',
    '/timetable/analysis': 'Timetable Analysis',
    '/internal-tests': 'Internal Tests & Exams',
    '/library-allotments': 'Library Schedule',
    '/leaves': 'Leave Approvals',
    '/replacements': 'Substitutions & Replacements',
    '/users': 'Users & Roles',
    '/audit': 'Audit Logs',
    '/settings': 'Settings',
    '/faculty/dashboard': 'My Dashboard',
    '/faculty/timetable': 'My Timetable',
    '/faculty/leaves': 'Leave Application',
    '/messages': 'Contact Messages',
};

const resolveTheme = (themeValue) => {
    if (themeValue === 'system') {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return (themeValue === 'dark' || themeValue === 'light') ? themeValue : 'light';
};

const Navbar = ({ toggleSidebar }) => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [theme, setTheme] = useState(() => {
        const sessionOverride = sessionStorage.getItem('ttms-theme-override');
        if (sessionOverride === 'dark' || sessionOverride === 'light') return sessionOverride;
        const defaultTheme = localStorage.getItem('ttms-default-theme') || 'light';
        return resolveTheme(defaultTheme);
    });
    const [notifOpen, setNotifOpen] = useState(false);
    const [profileOpen, setProfileOpen] = useState(false);
    const notifRef = useRef(null);
    const profileRef = useRef(null);

    let normalizedPath = location.pathname;
    if (normalizedPath.startsWith('/admin')) {
        normalizedPath = normalizedPath.replace('/admin', '') || '/dashboard';
    } else if (normalizedPath.startsWith('/department')) {
        normalizedPath = normalizedPath.replace('/department', '') || '/dashboard';
    }
    const currentLabel = routeLabels[normalizedPath] || routeLabels[location.pathname] || 'Dashboard';
    const displayName = user?.name || user?.full_name || user?.username || 'User';
    const initials = displayName ? displayName.slice(0, 2).toUpperCase() : 'AD';

    // Fetch Default UI Theme from server settings on mount & listen for live setting updates
    useEffect(() => {
        const fetchDefaultTheme = async () => {
            try {
                const res = await api.get('/settings');
                if (res.data?.success && res.data?.data?.default_theme) {
                    const dt = res.data.data.default_theme;
                    localStorage.setItem('ttms-default-theme', dt);
                    // Only apply if user hasn't overridden theme in this session
                    if (!sessionStorage.getItem('ttms-theme-override')) {
                        setTheme(resolveTheme(dt));
                    }
                }
            } catch (e) {
                // Ignore if settings fail to load
            }
        };
        fetchDefaultTheme();

        const handleDefaultThemeChanged = (e) => {
            if (e.detail) {
                sessionStorage.removeItem('ttms-theme-override');
                localStorage.setItem('ttms-default-theme', e.detail);
                setTheme(resolveTheme(e.detail));
            }
        };
        window.addEventListener('default-theme-changed', handleDefaultThemeChanged);
        return () => window.removeEventListener('default-theme-changed', handleDefaultThemeChanged);
    }, []);

    // Apply theme & page title
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.removeItem('ttms-theme'); // Clean up legacy persistent theme
    }, [theme]);

    useEffect(() => {
        document.title = `${currentLabel} | TTMS - AKS University`;
    }, [currentLabel]);

    const toggleTheme = () => {
        setTheme(prev => {
            const next = prev === 'light' ? 'dark' : 'light';
            sessionStorage.setItem('ttms-theme-override', next);
            return next;
        });
    };

    const fetchNotifications = async () => {
        try {
            if (user?.role === 'FACULTY') {
                await api.post('/notifications/check-reminders').catch(() => {});
            }
            const res = await api.get('/notifications');
            if (res.data.success) {
                const notifs = res.data.data || [];
                setNotifications(notifs);
                setUnreadCount(notifs.filter(n => !n.is_read).length);
            }
        } catch (e) {}
    };

    useEffect(() => {
        if (user) {
            fetchNotifications();
            const interval = setInterval(fetchNotifications, 60000);
            return () => clearInterval(interval);
        }
    }, [user]);

    // Close dropdowns on outside click
    useEffect(() => {
        const handleClick = (e) => {
            if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
            if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false);
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const handleMarkAllRead = async () => {
        try { await api.put('/notifications/read-all'); fetchNotifications(); } catch (e) {}
    };

    const handleMarkAsRead = async (id, is_read) => {
        if (is_read) return;
        try { await api.put(`/notifications/${id}/read`); fetchNotifications(); } catch (e) {}
    };

    const handleClearAll = async () => {
        try { await api.delete('/notifications/all'); fetchNotifications(); } catch (e) {}
    };

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    return (
        <div className="top-navbar">
            {/* Mobile menu toggle */}
            <button
                className="navbar-btn d-md-none"
                onClick={toggleSidebar}
                aria-label="Toggle sidebar"
            >
                <i className="bi bi-list"/>
            </button>

            {/* Page title */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                    fontFamily: 'Outfit, sans-serif',
                    fontSize: '15px',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                }}>
                    {currentLabel}
                </div>
            </div>

            {/* Right Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {/* Home Button */}
                <button
                    className="navbar-btn"
                    onClick={() => {
                        const path = user?.role === 'FACULTY' ? '/faculty/dashboard' : '/admin/dashboard';
                        navigate(path);
                    }}
                    title="Go to Dashboard"
                >
                    <i className="bi bi-house-door"/>
                </button>

                {/* Theme Toggle */}
                <button
                    className="navbar-btn"
                    onClick={toggleTheme}
                    title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
                >
                    <i className={`bi ${theme === 'light' ? 'bi-moon' : 'bi-sun'}`}/>
                </button>

                {/* Notifications */}
                <div ref={notifRef} style={{ position: 'relative' }}>
                    <button
                        className="navbar-btn"
                        onClick={() => { setNotifOpen(p => !p); setProfileOpen(false); }}
                        title="Notifications"
                    >
                        <i className="bi bi-bell"/>
                        {unreadCount > 0 && <span className="navbar-badge"/>}
                    </button>

                    {notifOpen && (
                        <div className="dropdown-menu show" style={{
                            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                            width: '320px', maxHeight: '380px',
                            display: 'flex', flexDirection: 'column',
                            zIndex: 1050
                        }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '10px 12px 8px', borderBottom: '1px solid var(--app-border-2)'
                            }}>
                                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                    Notifications
                                    {unreadCount > 0 && (
                                        <span style={{
                                            marginLeft: '8px', fontSize: '10px', background: 'var(--primary-600)',
                                            color: '#fff', borderRadius: '10px', padding: '1px 6px'
                                        }}>{unreadCount}</span>
                                    )}
                                </span>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    {unreadCount > 0 && (
                                        <button
                                            onClick={handleMarkAllRead}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary-600)', fontSize: '12px', padding: 0 }}
                                        >
                                            Mark all read
                                        </button>
                                    )}
                                    {notifications.length > 0 && (
                                        <button
                                            onClick={handleClearAll}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: '12px', padding: 0 }}
                                            title="Clear all notifications"
                                        >
                                            <i className="bi bi-trash" style={{ marginRight: '4px' }}/>Clear
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="scroll-area" style={{ flex: 1, overflowY: 'auto' }}>
                                {notifications.length > 0 ? notifications.slice(0, 10).map(n => (
                                    <div key={n.id} className="dropdown-item" 
                                        onClick={() => handleMarkAsRead(n.id, n.is_read)}
                                        style={{
                                        flexDirection: 'column', alignItems: 'flex-start',
                                        background: n.is_read ? 'transparent' : 'var(--primary-50)',
                                        borderRadius: 0, borderBottom: '1px solid var(--app-border-2)',
                                        padding: '10px 12px', cursor: 'pointer'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '3px' }}>
                                            <span style={{ fontWeight: 600, fontSize: '12.5px', color: 'var(--text-primary)' }}>
                                                {!n.is_read && <span style={{display:'inline-block', width: '6px', height: '6px', borderRadius:'50%', background:'var(--primary-600)', marginRight:'6px'}}></span>}
                                                {n.title}
                                            </span>
                                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                                {new Date(n.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                            </span>
                                        </div>
                                        <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'normal', lineHeight: 1.5 }}>{n.message}</span>
                                    </div>
                                )) : (
                                    <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-muted)', fontSize: '13px' }}>
                                        <i className="bi bi-bell-slash" style={{ fontSize: '24px', display: 'block', marginBottom: '8px', opacity: 0.5 }}/>
                                        No notifications
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Profile */}
                <div ref={profileRef} style={{ position: 'relative' }}>
                    <button
                        onClick={() => { setProfileOpen(p => !p); setNotifOpen(false); }}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            background: 'transparent', border: '1px solid var(--app-border)',
                            borderRadius: '8px', padding: '5px 10px',
                            cursor: 'pointer', transition: 'all 150ms ease'
                        }}
                    >
                        <div className="sidebar-avatar" style={{ width: '26px', height: '26px', fontSize: '10px' }}>{initials}</div>
                        <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', maxWidth: '90px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} className="d-none d-md-block">
                            {displayName}
                        </span>
                        <i className="bi bi-chevron-down d-none d-md-inline" style={{ fontSize: '10px', color: 'var(--text-muted)' }}/>
                    </button>

                    {profileOpen && (
                        <div className="dropdown-menu show" style={{
                            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                            zIndex: 1050
                        }}>
                            <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--app-border-2)', marginBottom: '4px' }}>
                                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{displayName}</div>
                                {user?.username && user?.username !== displayName && (
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>ID: {user?.username}</div>
                                )}
                                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', textTransform: 'capitalize', marginTop: '3px' }}>
                                    <span style={{
                                        background: 'var(--primary-50)', color: 'var(--primary-700)',
                                        border: '1px solid var(--primary-100)',
                                        borderRadius: '4px', padding: '1px 6px', fontSize: '10.5px', fontWeight: 600
                                    }}>
                                        {user?.role}
                                    </span>
                                </div>
                            </div>
                            {user?.role === 'SUPER_ADMIN' && (
                                <button className="dropdown-item" onClick={() => { 
                                    navigate('/admin/settings'); 
                                    setProfileOpen(false); 
                                }}>
                                    <i className="bi bi-gear"/>
                                    Settings
                                </button>
                            )}
                            <button className="dropdown-item" style={{ color: 'var(--danger)' }} onClick={handleLogout}>
                                <i className="bi bi-box-arrow-right"/>
                                Sign out
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Navbar;
