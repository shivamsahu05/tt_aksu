import jwt from 'jsonwebtoken';

export const protect = (req, res, next) => {
    let token;

    // Check cookies first
    if (req.cookies && req.cookies.token) {
        token = req.cookies.token;
    } 
    // Check auth header
    else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({ success: false, message: 'Not authorized, no token' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Not authorized, token failed' });
    }
};

export const requireRole = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Forbidden. You do not have permission to perform this action.' });
        }
        next();
    };
};

export const departmentScope = (req, res, next) => {
    if (req.user && req.user.role === 'DEPARTMENT_ADMIN') {
        req.departmentId = req.user.department_id;
    }
    next();
};

export const hasPermission = (permission) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Not authorized' });
        }
        
        // Super admin and Dept Admin have full access
        if (['SUPER_ADMIN', 'DEPARTMENT_ADMIN'].includes(req.user.role)) {
            return next();
        }
        
        // Check specific permissions array in JWT payload
        const userPermissions = req.user.permissions || [];
        if (userPermissions.includes(permission)) {
            return next();
        }
        
        return res.status(403).json({ message: 'Forbidden. You do not have permission to access this resource.' });
    };
};
