import React from 'react';

const StatusBadge = ({ active, activeLabel = 'Active', inactiveLabel = 'Inactive' }) => {
    if (active) {
        return <span className="badge badge-success">{activeLabel}</span>;
    }
    return <span className="badge badge-secondary">{inactiveLabel}</span>;
};

export default StatusBadge;
