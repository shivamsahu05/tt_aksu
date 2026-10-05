import React, { useEffect, useRef } from 'react';

const FormModal = ({ show, title, onClose, onSubmit, isSubmitting, children, size = 'md', submitLabel = 'Save Changes', hideFooter = false }) => {
    const dialogRef = useRef(null);

    useEffect(() => {
        if (show) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [show]);

    // Close on Escape
    useEffect(() => {
        const handler = (e) => { if (e.key === 'Escape' && !isSubmitting) onClose(); };
        if (show) document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [show, isSubmitting, onClose]);

    if (!show) return null;

    const sizeMap = { sm: '420px', md: '540px', lg: '720px', xl: '900px' };

    return (
        <>
            {/* Backdrop */}
            <div
                className="modal-backdrop"
                onClick={!isSubmitting ? onClose : undefined}
            />

            {/* Modal */}
            <div
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 1050,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '16px',
                    overflowY: 'auto',
                }}
            >
                <div
                    ref={dialogRef}
                    style={{
                        width: '100%',
                        maxWidth: sizeMap[size] || '540px',
                        margin: 'auto',
                    }}
                    className="modal-dialog"
                    role="dialog"
                    aria-modal="true"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="modal-content">
                        <form onSubmit={onSubmit} noValidate>
                            {/* Header */}
                            <div className="modal-header d-flex justify-content-between align-items-center">
                                <div>
                                    <h5 style={{
                                        fontFamily: 'Outfit, sans-serif',
                                        fontSize: '17px',
                                        fontWeight: 700,
                                        color: 'var(--text-primary)',
                                        margin: 0
                                    }}>
                                        {title}
                                    </h5>
                                </div>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    disabled={isSubmitting}
                                    aria-label="Close"
                                    style={{
                                        background: 'transparent',
                                        border: '1px solid var(--app-border)',
                                        borderRadius: '8px',
                                        width: '32px',
                                        height: '32px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        cursor: 'pointer',
                                        color: 'var(--text-muted)',
                                        transition: 'all 150ms ease',
                                        flexShrink: 0,
                                    }}
                                >
                                    <i className="bi bi-x" style={{ fontSize: '16px' }}/>
                                </button>
                            </div>

                            {/* Body */}
                            <div className="modal-body">
                                {children}
                            </div>

                            {/* Footer */}
                            {!hideFooter && (
                                <div className="modal-footer">
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={onClose}
                                        disabled={isSubmitting}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn btn-primary"
                                        disabled={isSubmitting}
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"/>
                                                Saving...
                                            </>
                                        ) : (
                                            <>
                                                <i className="bi bi-check-lg"/>
                                                {submitLabel}
                                            </>
                                        )}
                                    </button>
                                </div>
                            )}
                        </form>
                    </div>
                </div>
            </div>
        </>
    );
};

export default FormModal;
