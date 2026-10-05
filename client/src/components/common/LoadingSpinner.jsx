import React from 'react';

const LoadingSpinner = ({ colSpan, message = 'Loading...', fullPage }) => {
    const spinner = (
        <div style={{ textAlign: 'center', padding: fullPage ? '80px 24px' : '40px 24px' }}>
            <div style={{
                width: '36px', height: '36px',
                border: '3px solid var(--app-border)',
                borderTopColor: 'var(--primary-600)',
                borderRadius: '50%',
                animation: 'spin 0.7s linear infinite',
                margin: '0 auto 12px'
            }}/>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>{message}</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );

    if (colSpan) {
        return <tr><td colSpan={colSpan}>{spinner}</td></tr>;
    }

    if (fullPage) {
        return (
            <div style={{
                position: 'fixed', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--app-bg)', zIndex: 9999
            }}>
                {spinner}
            </div>
        );
    }

    return spinner;
};

export default LoadingSpinner;
