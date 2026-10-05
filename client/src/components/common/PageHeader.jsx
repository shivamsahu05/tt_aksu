import React from 'react';

const PageHeader = ({ title, subtitle, actionButton, icon, rightContent }) => {
    return (
        <div className="page-header">
            <div className="page-header-left">
                {icon && (
                    <div className="page-header-icon">
                        <i className={`bi ${icon}`}/>
                    </div>
                )}
                <div>
                    <h1 className="page-header-title">{title}</h1>
                    {subtitle && <p className="page-header-subtitle">{subtitle}</p>}
                </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-start' }}>
                {rightContent}
                {actionButton && (
                    <button
                        onClick={actionButton.onClick}
                        className={`btn btn-${actionButton.variant || 'primary'} rounded-pill shadow-sm`}
                        style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                    >
                        {actionButton.icon && <i className={`bi ${actionButton.icon} me-1`}/>}
                        {actionButton.label}
                    </button>
                )}
            </div>
        </div>
    );
};

export default PageHeader;
