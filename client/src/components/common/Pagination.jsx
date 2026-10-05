import React from 'react';

const Pagination = ({ page, totalPages, setPage }) => {
    if (!totalPages || totalPages <= 1) return null;

    const pages = Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
        if (totalPages <= 5) return i + 1;
        if (page <= 3) return i + 1;
        if (page >= totalPages - 2) return totalPages - 4 + i;
        return page - 2 + i;
    });

    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid var(--app-border-2)', background: 'var(--app-surface-2)' }}>
            <span style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
                Page {page} of {totalPages}
            </span>
            <div className="pagination-wrapper">
                <button className="page-btn" onClick={() => setPage(1)} disabled={page === 1}>
                    <i className="bi bi-chevron-double-left" style={{ fontSize: '11px' }}/>
                </button>
                <button className="page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                    <i className="bi bi-chevron-left" style={{ fontSize: '11px' }}/>
                </button>
                {pages.map(p => (
                    <button key={p} className={`page-btn ${page === p ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>
                ))}
                <button className="page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                    <i className="bi bi-chevron-right" style={{ fontSize: '11px' }}/>
                </button>
                <button className="page-btn" onClick={() => setPage(totalPages)} disabled={page === totalPages}>
                    <i className="bi bi-chevron-double-right" style={{ fontSize: '11px' }}/>
                </button>
            </div>
        </div>
    );
};

export default Pagination;
