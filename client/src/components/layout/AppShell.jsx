import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Navbar from './Navbar';
import ErrorBoundary from '../common/ErrorBoundary';

const AppShell = () => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true');

    React.useEffect(() => {
        localStorage.setItem('sidebarCollapsed', isCollapsed);
    }, [isCollapsed]);

    return (
        <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--app-bg)' }}>
            {/* Mobile Overlay */}
            <div
                className={`sidebar-overlay ${isSidebarOpen ? 'show' : ''}`}
                onClick={() => setIsSidebarOpen(false)}
            />

            <Sidebar isOpen={isSidebarOpen} setIsOpen={setIsSidebarOpen} isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />

            <div className={`main-content ${isCollapsed ? 'collapsed' : ''}`} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <Navbar toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />
                <div className="page-content" style={{ flex: 1 }}>
                    <ErrorBoundary>
                        <Outlet />
                    </ErrorBoundary>
                </div>
            </div>
        </div>
    );
};

export default AppShell;
