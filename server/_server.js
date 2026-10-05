import 'dotenv/config';
import fs from 'fs';
import path from 'path';

process.on('uncaughtException', (err) => {
    try {
        fs.appendFileSync('startup-debug.log', `[UNCAUGHT EXCEPTION] ${err.message}\n${err.stack}\n`);
    } catch(e) {}
    console.error('[UNCAUGHT EXCEPTION]', err.message);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    // Log but do NOT crash the server for DB-related rejections (e.g. autoPatchDb errors)
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error('[UNHANDLED REJECTION]', msg);
    try {
        fs.appendFileSync('startup-debug.log', `[UNHANDLED REJECTION] ${msg}\n`);
    } catch(e) {}
    // Only exit for non-DB errors
    if (reason instanceof Error && reason.code && ['ECONNREFUSED','ER_ACCESS_DENIED_ERROR','ER_BAD_DB_ERROR'].includes(reason.code)) {
        console.error('[DB ERROR - non-fatal, server continues running]');
        return; // Don't crash
    }
});

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import os from 'os';

import authRoutes from './routes/authRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import departmentRoutes from './routes/departmentRoutes.js';
import sessionRoutes from './routes/sessionRoutes.js';
import roomRoutes from './routes/roomRoutes.js';
import teacherRoutes from './routes/teacherRoutes.js';
import subjectRoutes from './routes/subjectRoutes.js';
import classRoutes from './routes/classRoutes.js';
import allocationRoutes from './routes/allocationRoutes.js';
import timetableRoutes from './routes/timetableRoutes.js';
import userRoutes from './routes/userRoutes.js';
import leaveRoutes from './routes/leaveRoutes.js';
import replacementRoutes from './routes/replacementRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import auditRoutes from './routes/auditRoutes.js';
import timeSlotRoutes from './routes/timeSlotRoutes.js';
import internalTestRoutes from './routes/internalTestRoutes.js';
import libraryAllotmentRoutes from './routes/libraryAllotmentRoutes.js';
import messageRoutes from './routes/messageRoutes.js';
import { errorHandler, notFound } from './middlewares/errorHandler.js';
import { fileURLToPath } from 'url';
import db from './config/db.js';
import NotificationService from './services/NotificationService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Serve static files (uploads)
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

app.set('trust proxy', 1);

// Security middlewares
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false
}));

// CORS configuration (allow all valid production & dev origins)
app.use(cors({
    origin: (origin, callback) => {
        callback(null, true);
    },
    credentials: true
}));

// Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Logger
if (process.env.NODE_ENV !== 'production') {
    app.use(morgan('dev'));
}

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/teachers', teacherRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/allocations', allocationRoutes);
app.use('/api/timetable', timetableRoutes);
app.use('/api/users', userRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/replacements', replacementRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/timeslots', timeSlotRoutes);
app.use('/api/internal-tests', internalTestRoutes);
app.use('/api/library-allotments', libraryAllotmentRoutes);
app.use('/api/messages', messageRoutes);

// Health Check Endpoints (prevent hosting container restart loops & 503 errors)
app.get(['/health', '/api/health', '/ping'], (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// SEO-friendly robots.txt, sitemap.xml, and favicon.ico endpoints
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.status(200).send("User-agent: *\nAllow: /\nSitemap: https://timetable-aksu.hackvitrasec.com/sitemap.xml\n");
});

app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml');
    res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>https://timetable-aksu.hackvitrasec.com/</loc>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>
</urlset>`);
});

app.get('/favicon.ico', (req, res) => {
    const faviconPath = path.join(__dirname, '../client/dist/favicon.ico');
    if (fs.existsSync(faviconPath)) {
        return res.sendFile(faviconPath);
    }
    res.status(204).end();
});

// DEBUG ENDPOINT - shows exactly what paths server sees on live hosting
app.get('/api/debug-server-paths', (req, res) => {
    const results = [];
    const checkPath = (label, p) => {
        try {
            const idxPath = path.join(p, 'index.html');
            const dirExists = fs.existsSync(p);
            const idxExists = fs.existsSync(idxPath);
            let isReal = false;
            if (idxExists) {
                const content = fs.readFileSync(idxPath, 'utf8').slice(0, 200);
                isReal = content.includes('<html') && !content.includes('TTMS_FALLBACK_PAGE_MARKER');
            }
            results.push({ label, path: p, dirExists, idxExists, isRealSPA: isReal });
        } catch (e) {
            results.push({ label, path: p, error: e.message });
        }
    };

    checkPath('__dirname', __dirname);
    checkPath('cwd', process.cwd());
    checkPath('__dirname/../client/dist', path.join(__dirname, '../client/dist'));
    checkPath('__dirname/../dist', path.join(__dirname, '../dist'));
    checkPath('__dirname/..', path.join(__dirname, '..'));
    checkPath('__dirname/../..', path.join(__dirname, '../..'));
    checkPath('__dirname/../../..', path.join(__dirname, '../../..'));
    checkPath('cwd/client/dist', path.join(process.cwd(), 'client/dist'));
    checkPath('cwd/..', path.join(process.cwd(), '..'));

    try {
        const home = os.homedir();
        checkPath('os.homedir()', home);
        checkPath('homedir/public_html', path.join(home, 'public_html'));
        checkPath('homedir/domains/timetable-aksu.hackvitrasec.com/public_html', path.join(home, 'domains/timetable-aksu.hackvitrasec.com/public_html'));
        checkPath('homedir/timetable-aksu.hackvitrasec.com', path.join(home, 'timetable-aksu.hackvitrasec.com'));
    } catch (e) {}

    res.json({
        __dirname,
        cwd: process.cwd(),
        homedir: os.homedir(),
        DOCUMENT_ROOT: process.env.DOCUMENT_ROOT || null,
        foundSPAIndex: results.find(r => r.isRealSPA)?.path || 'NOT FOUND - check pathChecks below',
        pathChecks: results
    });
});

// Serve frontend static files or SEO-friendly fallback page
const getExtensiveSearchDirs = () => {
    const dirs = new Set();
    const addDir = (d) => {
        try {
            if (d && fs.existsSync(d)) dirs.add(path.resolve(d));
        } catch (e) {}
    };

    // 1. Current & relative paths up to 8 levels
    let p = __dirname;
    for (let i = 0; i < 8; i++) {
        addDir(path.join(p, 'client/dist'));
        addDir(path.join(p, 'dist'));
        addDir(path.join(p, 'build'));
        addDir(path.join(p, 'public_html'));
        addDir(path.join(p, 'public'));
        addDir(path.join(p, 'www'));
        addDir(path.join(p, 'html'));
        addDir(p);
        const parent = path.dirname(p);
        if (parent === p) break;
        p = parent;
    }

    // 2. process.cwd() paths
    let c = process.cwd();
    for (let i = 0; i < 8; i++) {
        addDir(path.join(c, 'client/dist'));
        addDir(path.join(c, 'dist'));
        addDir(path.join(c, 'build'));
        addDir(path.join(c, 'public_html'));
        addDir(path.join(c, 'public'));
        addDir(path.join(c, 'www'));
        addDir(c);
        const parent = path.dirname(c);
        if (parent === c) break;
        c = parent;
    }

    // 3. Environment DOCUMENT_ROOT & HOME
    if (process.env.DOCUMENT_ROOT) {
        addDir(path.resolve(process.env.DOCUMENT_ROOT));
        addDir(path.resolve(process.env.DOCUMENT_ROOT, 'client/dist'));
    }

    // 4. Linux / cPanel / Hostinger home directories
    try {
        const home = os.homedir();
        if (home) {
            addDir(path.join(home, 'public_html'));
            addDir(path.join(home, 'domains/timetable-aksu.hackvitrasec.com/public_html'));
            addDir(path.join(home, 'domains/timetable-aksu.hackvitrasec.com'));
            addDir(path.join(home, 'timetable-aksu.hackvitrasec.com/public_html'));
            addDir(path.join(home, 'timetable-aksu.hackvitrasec.com'));
            addDir(path.join(home, 'www'));
            addDir(path.join(home, 'html'));
        }
    } catch (e) {}

    return Array.from(dirs);
};

const possibleDistPaths = getExtensiveSearchDirs();

possibleDistPaths.forEach(dir => {
    try {
        app.use(express.static(dir));
    } catch (e) {}
});

const findSPAIndexPath = () => {
    const isRealSPAIndex = (filePath) => {
        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8');
                if (content && !content.includes('TTMS_FALLBACK_PAGE_MARKER') && (content.includes('<html') || content.includes('<HTML'))) {
                    return true;
                }
            }
        } catch (e) {}
        return false;
    };

    for (const dir of possibleDistPaths) {
        const idx = path.join(dir, 'index.html');
        if (isRealSPAIndex(idx)) {
            return idx;
        }
    }

    return null;
};

app.get(/^(.*)$/, (req, res) => {
    const sendFallback = () => {
        if (!res.headersSent) {
            res.status(200).send(`<!DOCTYPE html>
<!-- TTMS_FALLBACK_PAGE_MARKER -->
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TTMS - AKS University | Smart Timetable & Room Allocation Portal</title>
    <meta name="description" content="AKS University Smart Timetable and Room Allocation Management System. High-performance scheduling, smart classroom optimization, and academic management portal.">
    <meta name="robots" content="index, follow">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Inter', -apple-system, sans-serif;
            background: #0b0f19;
            color: #f1f5f9;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 24px;
            text-align: center;
            background-image: 
                radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.12) 0px, transparent 50%),
                radial-gradient(at 100% 100%, rgba(14, 165, 233, 0.12) 0px, transparent 50%);
        }
        .container {
            background: rgba(30, 41, 59, 0.65);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 24px;
            padding: 48px 36px;
            max-width: 540px;
            width: 100%;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(20px);
            position: relative;
            overflow: hidden;
        }
        .badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: rgba(99, 102, 241, 0.15);
            color: #818cf8;
            border: 1px solid rgba(99, 102, 241, 0.3);
            padding: 6px 16px;
            border-radius: 999px;
            font-size: 12.5px;
            font-weight: 600;
            margin-bottom: 24px;
            letter-spacing: 0.5px;
            text-transform: uppercase;
        }
        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #22c55e;
            box-shadow: 0 0 8px #22c55e;
            animation: pulse 2s infinite;
        }
        h1 {
            font-family: 'Outfit', sans-serif;
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 14px;
            background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            line-height: 1.25;
        }
        p {
            color: #94a3b8;
            font-size: 15px;
            line-height: 1.6;
            margin-bottom: 32px;
        }
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
            color: #ffffff;
            text-decoration: none;
            font-weight: 600;
            font-size: 15px;
            padding: 14px 32px;
            border-radius: 14px;
            box-shadow: 0 10px 25px -5px rgba(99, 102, 241, 0.4);
            transition: all 0.25s ease;
            cursor: pointer;
            border: none;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 15px 30px -5px rgba(99, 102, 241, 0.55);
        }
        .meta {
            margin-top: 36px;
            padding-top: 24px;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            font-size: 13px;
            color: #64748b;
        }
        @keyframes pulse {
            0%, 100% { opacity: 0.4; transform: scale(0.9); }
            50% { opacity: 1; transform: scale(1.1); }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="badge">
            <span class="status-dot"></span>
            AKS University • TTMS Portal
        </div>
        <h1>Timetable & Room Allocation System</h1>
        <p>The backend application server is active and operational. The frontend interface is currently synchronizing. Click refresh to launch the portal.</p>
        <button onclick="window.location.reload()" class="btn">
            Refresh Application
        </button>
        <div class="meta">
            AKS University Smart Campus • Automated Scheduling Engine
        </div>
    </div>
    <script>
        setTimeout(() => {
            fetch('/?check=1', { cache: 'no-store' }).then(r => r.text()).then(html => {
                if (html && !html.includes('TTMS_FALLBACK_PAGE_MARKER')) {
                    window.location.reload();
                }
            }).catch(() => {});
        }, 8000);
    </script>
</body>
</html>`);
        }
    };

    // Direct path first (fastest, most reliable on Hostinger .builds)
    const directPath = path.resolve(__dirname, '../client/dist/index.html');
    const indexPath = (fs.existsSync(directPath) ? directPath : null) || findSPAIndexPath();

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');

    if (indexPath) {
        try {
            const html = fs.readFileSync(indexPath, 'utf8');
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.status(200).send(html);
        } catch (readErr) {
            console.error('[SPA] readFileSync failed:', indexPath, readErr.message);
            sendFallback();
        }
    } else {
        console.error('[SPA] index.html not found. __dirname:', __dirname, 'cwd:', process.cwd());
        sendFallback();
    }
});

// Auto-patch missing columns for live deployment
const autoPatchDb = async () => {
    try {
        await db.query('ALTER TABLE sections ADD COLUMN merge_group_id VARCHAR(50) NULL');
        console.log('Successfully added merge_group_id column to sections table.');
    } catch (error) {
        if (error.code !== 'ER_DUP_FIELDNAME') {
            console.error('Error auto-patching DB (sections):', error.message);
        }
    }
    try {
        await db.query("ALTER TABLE subjects ADD COLUMN nptel_mode VARCHAR(20) DEFAULT 'BOTH'");
        console.log('Successfully added nptel_mode column to subjects table.');
    } catch (error) {
        if (error.code !== 'ER_DUP_FIELDNAME') {
            console.error('Error auto-patching DB (subjects):', error.message);
        }
    }
    try {
        await db.query("ALTER TABLE section_subjects ADD COLUMN is_online TINYINT(1) NOT NULL DEFAULT 0 AFTER room_id");
        console.log("Migration: Added is_online to section_subjects");
    } catch (e) {}
    try {
        await db.query("ALTER TABLE timetable ADD COLUMN is_online TINYINT(1) NOT NULL DEFAULT 0 AFTER room_id");
        console.log("Migration: Added is_online to timetable");
    } catch (e) {}
    try {
        await db.query("ALTER TABLE timetable MODIFY COLUMN room_id int(10) UNSIGNED DEFAULT NULL");
    } catch (e) {}
    try {
        await db.query("ALTER TABLE classes ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1");
        console.log("Migration: Added is_active to classes");
    } catch (e) {}
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS internal_tests (
                id INT AUTO_INCREMENT PRIMARY KEY,
                department_id INT UNSIGNED NULL,
                room_id INT UNSIGNED NOT NULL,
                class_id INT UNSIGNED NULL,
                invigilator_id INT UNSIGNED NULL,
                test_name VARCHAR(255) NOT NULL,
                test_type VARCHAR(50) DEFAULT 'Class Test',
                ref_id VARCHAR(100) NULL,
                test_date DATE NOT NULL,
                start_time TIME NOT NULL,
                end_time TIME NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
                FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL,
                FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL,
                FOREIGN KEY (invigilator_id) REFERENCES teachers(id) ON DELETE SET NULL
            )
        `);
        console.log("Migration: Created internal_tests table");
    } catch (e) {
        console.error("Migration Error (internal_tests):", e.message);
    }
    
    try {
        const [columns] = await db.query("SHOW COLUMNS FROM internal_tests");
        if (!columns.some(col => col.Field === 'class_id')) {
            console.log('Patching internal_tests table with class_id, invigilator_id, and session_id...');
            await db.query('ALTER TABLE internal_tests ADD COLUMN class_id INT UNSIGNED NULL AFTER room_id, ADD COLUMN invigilator_id INT UNSIGNED NULL AFTER class_id, ADD COLUMN session_id INT UNSIGNED NULL AFTER department_id');
            await db.query('ALTER TABLE internal_tests ADD FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL, ADD FOREIGN KEY (invigilator_id) REFERENCES teachers(id) ON DELETE SET NULL, ADD FOREIGN KEY (session_id) REFERENCES academic_sessions(id) ON DELETE CASCADE');
            console.log('internal_tests patched successfully.');
        } else if (!columns.some(col => col.Field === 'session_id')) {
            console.log('Patching internal_tests table with session_id...');
            await db.query('ALTER TABLE internal_tests ADD COLUMN session_id INT UNSIGNED NULL AFTER department_id');
            await db.query('ALTER TABLE internal_tests ADD FOREIGN KEY (session_id) REFERENCES academic_sessions(id) ON DELETE CASCADE');
            console.log('internal_tests patched successfully.');
        }
    } catch (e) {
        console.error('Error patching internal_tests:', e.message);
    }
    
    // Patch 2: Add subject_id, ref_id, test_type, invigilator_ids
    try {
        const [columns] = await db.query("SHOW COLUMNS FROM internal_tests");
        if (!columns.some(col => col.Field === 'test_type')) {
            console.log('Patching internal_tests table with test_type, ref_id, invigilator_ids, subject_id...');
            await db.query(`
                ALTER TABLE internal_tests 
                ADD COLUMN subject_id INT UNSIGNED NULL AFTER class_id, 
                ADD COLUMN ref_id VARCHAR(100) NULL AFTER subject_id,
                ADD COLUMN test_type VARCHAR(50) DEFAULT 'Class Test' AFTER test_name,
                ADD COLUMN invigilator_ids VARCHAR(255) NULL AFTER invigilator_id
            `);
            await db.query('ALTER TABLE internal_tests ADD FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL');
            console.log('internal_tests patched with advanced fields successfully.');
        }
    } catch (e) {
        console.error('Error patching internal_tests with advanced fields:', e.message);
    }
};
autoPatchDb();

// Error Handling
app.use(notFound);
app.use(errorHandler);

// Request Logging Middleware for Deep Debugging
app.use((req, res, next) => {
    console.log(`[HTTP] ${req.method} ${req.url}`);
    next();
});

// ─── PORT / SOCKET DETECTION ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

console.log(`[SERVER] Starting... NODE_ENV=${process.env.NODE_ENV} LISTEN=${PORT}`);
console.log(`[SERVER] DB_HOST=${process.env.DB_HOST} DB_NAME=${process.env.DB_NAME}`);

const HOST = process.env.HOST || '0.0.0.0';
const server = app.listen(PORT, HOST, () => {
    console.log(`[SERVER] ✅ Listening on ${HOST}:${PORT}`);
    setInterval(() => {
        NotificationService.checkAndSendUpcomingClassAlerts().catch(() => {});
    }, 60 * 1000);
    console.log("Notification Scheduler: Started.");
});

server.on('error', (err) => {
    console.error(`[SERVER] FATAL LISTEN ERROR: ${err.message}`);
    console.error(err);
    try {
        fs.appendFileSync(path.join(process.cwd(), 'startup-debug.log'), `\n[SERVER LISTEN ERROR] ${err.message}\n${err.stack}\n`);
    } catch(e) {}
    process.exit(1);
});
