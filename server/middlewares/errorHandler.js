export const notFound = (req, res, next) => {
    res.status(404).json({
        success: false,
        message: `Not Found - ${req.originalUrl}`
    });
};

export const errorHandler = (err, req, res, next) => {
    console.error(err.stack);

    const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
    
    let message = err.message || 'Internal Server Error';

    // Handle database connection errors (Hostinger / MySQL)
    if (
        err.code === 'ECONNREFUSED' || 
        err.code === 'ETIMEDOUT' || 
        err.code === 'PROTOCOL_CONNECTION_LOST' ||
        err.code === 'ECONNRESET' ||
        err.code === 'ER_CON_COUNT_ERROR' ||
        (err.message && err.message.toLowerCase().includes('connect')) ||
        (err.message && err.message.toLowerCase().includes('timeout'))
    ) {
        message = 'Please wait, Database Connection is being established...';
    }

    res.status(statusCode).json({
        success: false,
        message: message,
        stack: process.env.NODE_ENV === 'production' ? null : err.stack
    });
};
