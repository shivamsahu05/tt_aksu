import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Helper to ensure directory exists
const ensureDirExists = (dirPath) => {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
};

// Set storage engine
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        const dir = 'public/uploads/teachers/';
        ensureDirExists(dir);
        cb(null, dir);
    },
    filename: function(req, file, cb) {
        cb(null, `teacher-${Date.now()}${path.extname(file.originalname)}`);
    }
});

// Check file type
function checkFileType(file, cb) {
    const filetypes = /jpeg|jpg|png|webp/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('Images only (jpeg, jpg, png, webp)!'));
    }
}

export const uploadTeacherPhoto = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit
    fileFilter: function(req, file, cb) {
        checkFileType(file, cb);
    }
});

// CSV Upload Middleware for bulk operations
const csvStorage = multer.diskStorage({
    destination: function(req, file, cb) {
        const dir = 'public/uploads/temp/';
        ensureDirExists(dir);
        cb(null, dir);
    },
    filename: function(req, file, cb) {
        cb(null, `bulk-${Date.now()}${path.extname(file.originalname)}`);
    }
});

export const uploadCSV = multer({
    storage: csvStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function(req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        const allowedExts = ['.csv', '.xlsx', '.xls'];
        const allowedMimeTypes = [
            'text/csv',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel'
        ];

        if (allowedMimeTypes.includes(file.mimetype) || allowedExts.includes(ext)) {
            return cb(null, true);
        } else {
            cb(new Error('Only CSV and Excel (.xlsx, .xls) files are allowed!'));
        }
    }
});
