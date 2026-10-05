import React from 'react';

const DataTable = ({
    columns,
    data,
    loading,
    searchTerm,
    onSearch,
    page,
    totalPages,
    totalRows,
    setPage,
    emptyMessage = 'No records found.',
    emptyIcon = 'bi-inbox',
    renderRow,
    rowClassName,
    hidePagination,
    searchPlaceholder = 'Search...',
    rightActions,
}) => {

    const SkeletonRow = () => (
        <tr>
            {columns.map((_, i) => (
                <td key={i} style={{ padding: '14px 16px' }}>
                    <div className="skeleton" style={{ height: '14px', borderRadius: '4px', width: i === 0 ? '60%' : '40%' }}/>
                </td>
            ))}
        </tr>
    );

    return (
        <div className="data-table-wrapper">
            {/* Toolbar */}
            {(onSearch || rightActions) && (
                <div className="data-table-header">
                    {onSearch ? (
                        <div className="search-input-wrapper">
                            <i className="bi bi-search search-icon"/>
                            <input
                                type="text"
                                className="form-control"
                                placeholder={searchPlaceholder}
                                value={searchTerm}
                                onChange={e => onSearch(e.target.value)}
                                style={{ paddingLeft: '32px' }}
                            />
                        </div>
                    ) : <div/>}
                    {rightActions && <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>{rightActions}</div>}
                </div>
            )}

            {/* Table */}
            <div style={{ overflowX: 'auto' }}>
                <table className="table table-hover" style={{ minWidth: '100%', marginBottom: 0 }}>
                    <thead>
                        <tr>
                            {columns.map((col, idx) => (
                                <th key={idx} className={col.className || ''} style={col.headerStyle || {}}>
                                    {col.label || col.header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i}/>)
                        ) : data.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length}>
                                    <div className="empty-state">
                                        <div className="empty-state-icon">
                                            <i className={`bi ${emptyIcon}`}/>
                                        </div>
                                        <div className="empty-state-title">No records found</div>
                                        <p className="empty-state-text">{emptyMessage}</p>
                                    </div>
                                </td>
                            </tr>
                        ) : data.map((row, idx) => (
                            renderRow ? renderRow(row, idx) : (
                                <tr key={row.id || idx} className={rowClassName ? rowClassName(row) : ''}>
                                    {columns.map((col, colIdx) => (
                                        <td key={colIdx} className={col.cellClassName || ''}>
                                            {col.render
                                                ? col.render(typeof col.accessor === 'function' ? col.accessor(row, idx) : row[col.accessor], row)
                                                : typeof col.accessor === 'function'
                                                    ? col.accessor(row, idx)
                                                    : row[col.accessor]
                                            }
                                        </td>
                                    ))}
                                </tr>
                            )
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Pagination Footer */}
            {!hidePagination && !loading && totalPages >= 1 && setPage && (
                <div className="table-footer">
                    <span style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
                        {totalRows ? `${totalRows} record${totalRows !== 1 ? 's' : ''}` : `Page ${page} of ${totalPages}`}
                    </span>
                    <div className="pagination-wrapper">
                        <button type="button"
                            className="page-btn"
                            onClick={() => setPage(1)}
                            disabled={page === 1}
                            title="First page"
                        >
                            <i className="bi bi-chevron-double-left" style={{ fontSize: '11px' }}/>
                        </button>
                        <button type="button"
                            className="page-btn"
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1}
                        >
                            <i className="bi bi-chevron-left" style={{ fontSize: '11px' }}/>
                        </button>

                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                            let p;
                            if (totalPages <= 5) {
                                p = i + 1;
                            } else if (page <= 3) {
                                p = i + 1;
                            } else if (page >= totalPages - 2) {
                                p = totalPages - 4 + i;
                            } else {
                                p = page - 2 + i;
                            }
                            return (
                                <button type="button"
                                    key={p}
                                    className={`page-btn ${page === p ? 'active' : ''}`}
                                    onClick={() => setPage(p)}
                                >
                                    {p}
                                </button>
                            );
                        })}

                        <button type="button"
                            className="page-btn"
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                        >
                            <i className="bi bi-chevron-right" style={{ fontSize: '11px' }}/>
                        </button>
                        <button type="button"
                            className="page-btn"
                            onClick={() => setPage(totalPages)}
                            disabled={page === totalPages}
                            title="Last page"
                        >
                            <i className="bi bi-chevron-double-right" style={{ fontSize: '11px' }}/>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DataTable;
