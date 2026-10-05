import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="d-flex justify-content-center align-items-center w-100 h-100" style={{ minHeight: '60vh' }}>
                    <div className="card border-0 shadow-sm rounded-4 text-center p-5" style={{ maxWidth: '600px' }}>
                        <div className="text-danger mb-4">
                            <i className="bi bi-exclamation-octagon" style={{ fontSize: '4rem' }}></i>
                        </div>
                        <h3 className="fw-bold text-dark mb-3">Something went wrong in this page</h3>
                        <p className="text-muted mb-4">An error occurred while loading this page. Please try refreshing or check your code for syntax errors.</p>
                        <div className="bg-light p-3 rounded-3 text-start overflow-auto" style={{ maxHeight: '200px' }}>
                            <pre className="mb-0 text-danger small" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                {this.state.error && this.state.error.toString()}
                            </pre>
                        </div>
                        <button 
                            className="btn btn-primary rounded-pill px-4 py-2 mt-4"
                            onClick={() => window.location.reload()}
                        >
                            <i className="bi bi-arrow-clockwise me-2"></i> Refresh Page
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
