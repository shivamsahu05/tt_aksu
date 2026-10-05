import React from 'react';

const EmptyState = ({ message, icon = 'bi-inbox', title = 'No records found', colSpan, action }) => {
    const content = (
        <div className="empty-state">
            <div className="empty-state-icon">
                <i className={`bi ${icon}`}/>
            </div>
            <div className="empty-state-title">{title}</div>
            {message && <p className="empty-state-text">{message}</p>}
            {action && (
                <button
                    className="btn btn-primary"
                    onClick={action.onClick}
                    style={{ marginTop: '16px' }}
                >
                    {action.icon && <i className={`bi ${action.icon}`}/>}
                    {action.label}
                </button>
            )}
        </div>
    );

    if (colSpan) {
        return <tr><td colSpan={colSpan}>{content}</td></tr>;
    }

    return content;
};

export default EmptyState;
