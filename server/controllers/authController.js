import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import db from '../config/db.js';
import nodemailer from 'nodemailer';
import NotificationService from '../services/NotificationService.js';

const transporter = nodemailer.createTransport({
    host: 'smtp.hostinger.com',
    port: 465,
    secure: true,
    auth: {
        user: 'support@timetable-aksu.hackvitrasec.com',
        pass: '$u770Rt@123'
    },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
});
// @route POST /api/auth/login
export const login = async (req, res, next) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Please provide both username and password.' });
        }

        const [users] = await db.execute(`
            SELECT u.*, COALESCE(t.full_name, u.username) as name, COALESCE(t.full_name, u.username) as full_name
            FROM users u
            LEFT JOIN teachers t ON u.teacher_id = t.id
            WHERE u.username = ?
        `, [username]);
        
        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }

        const user = users[0];

        // Check if account is blocked
        if (user.is_active === 0) {
            return res.status(403).json({ success: false, message: 'Your account has been blocked due to multiple failed login attempts. Please contact an Administrator.' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            // Increment failed attempts
            const newAttempts = (user.failed_login_attempts || 0) + 1;
            if (newAttempts >= 10) {
                await db.execute('UPDATE users SET is_active = 0, failed_login_attempts = ? WHERE id = ?', [newAttempts, user.id]);
                return res.status(403).json({ success: false, message: 'Your account has been blocked due to multiple failed login attempts. Please contact an Administrator.' });
            } else {
                await db.execute('UPDATE users SET failed_login_attempts = ? WHERE id = ?', [newAttempts, user.id]);
                return res.status(401).json({ success: false, message: `Invalid credentials. Attempt ${newAttempts}/10.` });
            }
        }

        // Reset failed attempts on successful password check
        await db.execute('UPDATE users SET failed_login_attempts = 0 WHERE id = ?', [user.id]);

        if (user.role === 'SUPER_ADMIN' || user.role === 'DEPARTMENT_ADMIN') {
            // Check Notification Settings First
            const [settingsRows] = await db.query('SELECT setting_key, setting_value FROM settings WHERE setting_key IN ("email_notifications", "sms_notifications", "whatsapp_notifications")');
            let isEmailEnabled = false, isSmsEnabled = false, isWhatsappEnabled = false;
            settingsRows.forEach(r => {
                if(r.setting_key === 'email_notifications' && r.setting_value === 'enabled') isEmailEnabled = true;
                if(r.setting_key === 'sms_notifications' && r.setting_value === 'enabled') isSmsEnabled = true;
                if(r.setting_key === 'whatsapp_notifications' && r.setting_value === 'enabled') isWhatsappEnabled = true;
            });

            let availableChannels = [];
            if (isEmailEnabled) availableChannels.push('email');
            if (isSmsEnabled) availableChannels.push('sms');
            if (isWhatsappEnabled) availableChannels.push('whatsapp');

            if (availableChannels.length === 0) {
                return res.status(503).json({ success: false, message: 'Server Maintenance Work is going on. OTP services are temporarily disabled.' });
            }

            return res.json({ success: true, requiresOtp: true, email: user.email, username: user.username, availableChannels });
        }

        // --- NORMAL LOGIN FOR FACULTY ---
        // Update last login
        await db.execute('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

        const payload = {
            id: user.id,
            username: user.username,
            name: user.name,
            full_name: user.full_name,
            role: user.role,
            department_id: user.department_id,
            teacher_id: user.teacher_id,
            permissions: user.permissions ? (typeof user.permissions === 'string' ? JSON.parse(user.permissions) : user.permissions) : [],
            accessible_departments: user.accessible_departments ? (typeof user.accessible_departments === 'string' ? JSON.parse(user.accessible_departments) : user.accessible_departments) : []
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });

        // Session cookie: no maxAge / expires => cookie deleted when browser is closed
        // This forces user to re-login when they open a new browser session
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict'
            // maxAge intentionally omitted → becomes a session cookie (cleared on browser close)
        });

        // Log the login activity
        try {
            const ipAddress = req.ip || req.connection.remoteAddress || null;
            await db.query(
                `INSERT INTO audit_logs (user_id, action, table_name, record_id, ip_address) VALUES (?, ?, ?, ?, ?)`,
                [user.id, 'login', 'users', user.id, ipAddress]
            );
        } catch (auditErr) {
            console.error("Failed to insert login audit log:", auditErr);
        }

        return res.json({
            success: true,
            token,
            user: payload
        });
    } catch (error) {
        next(error);
    }
};

// @route POST /api/auth/send-otp
export const sendOtp = async (req, res) => {
    try {
        const { username, channel } = req.body; // channel: 'email' | 'sms' | 'whatsapp'
        if (!username || !channel) return res.status(400).json({ success: false, message: 'Username and channel are required' });

        const [users] = await db.query('SELECT * FROM users WHERE username = ? OR email = ?', [username, username]);
        if (users.length === 0) return res.status(404).json({ success: false, message: 'User not found' });
        
        const user = users[0];

        const [settingsRows] = await db.query('SELECT setting_key, setting_value FROM settings WHERE setting_key IN ("email_notifications", "sms_notifications", "whatsapp_notifications")');
        let isEmailEnabled = false, isSmsEnabled = false, isWhatsappEnabled = false;
        settingsRows.forEach(r => {
            if(r.setting_key === 'email_notifications' && r.setting_value === 'enabled') isEmailEnabled = true;
            if(r.setting_key === 'sms_notifications' && r.setting_value === 'enabled') isSmsEnabled = true;
            if(r.setting_key === 'whatsapp_notifications' && r.setting_value === 'enabled') isWhatsappEnabled = true;
        });

        // Generate new OTP
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        await db.execute('UPDATE users SET otp_code = ?, otp_expires_at = DATE_ADD(NOW(), INTERVAL 10 MINUTE) WHERE id = ?', [otpCode, user.id]);
        
        const textMessage = `🔐 TTMS Login OTP\n\nYour OTP for login is: ${otpCode}\nValid for 10 minutes. Do not share.`;
        const htmlMessage = `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
                <h2 style="color: #4338ca; margin-bottom: 8px;">🔐 TTMS Login OTP</h2>
                <p style="color: #64748b;">Use the following One-Time Password to complete your login:</p>
                <div style="background: #f1f5f9; border-radius: 8px; padding: 18px; text-align: center; margin: 16px 0;">
                    <span style="font-size: 2.5rem; font-weight: 800; letter-spacing: 12px; color: #1e1b4b;">${otpCode}</span>
                </div>
                <p style="color: #64748b; font-size: 13px;">This OTP is valid for <strong>10 minutes</strong>. Do not share it with anyone.</p>
                <hr style="border:none;border-top:1px solid #e2e8f0; margin: 16px 0;">
                <p style="color: #94a3b8; font-size: 12px;">Timetable Management System</p>
            </div>
        `;

        if (channel === 'email') {
            if (!isEmailEnabled) return res.status(403).json({ success: false, message: 'Email OTP is disabled.' });
            if (!user.email) return res.status(400).json({ success: false, message: 'No registered email found.' });
            await NotificationService.sendNotification('email', user.email, htmlMessage, 'Your TTMS Login OTP');
            return res.json({ success: true, message: 'OTP sent via Email.' });
        } else if (channel === 'sms') {
            if (!isSmsEnabled) return res.status(403).json({ success: false, message: 'SMS OTP is disabled.' });
            if (!user.mobile) return res.status(400).json({ success: false, message: 'No registered mobile found.' });
            await NotificationService.sendNotification('sms', user.mobile, textMessage);
            return res.json({ success: true, message: 'OTP sent via SMS.' });
        } else if (channel === 'whatsapp') {
            if (!isWhatsappEnabled) return res.status(403).json({ success: false, message: 'WhatsApp OTP is disabled.' });
            if (!user.mobile) return res.status(400).json({ success: false, message: 'No registered mobile found.' });
            await NotificationService.sendNotification('whatsapp', user.mobile, textMessage);
            return res.json({ success: true, message: 'OTP sent via WhatsApp.' });
        }

        return res.status(400).json({ success: false, message: 'Invalid channel selected' });
    } catch (error) {
        console.error('Send OTP Error:', error);
        if (error.message && error.message.includes('maintenance')) {
            return res.status(503).json({ success: false, message: error.message });
        }
        res.status(500).json({ success: false, message: error.message || 'Failed to send OTP' });
    }
};

// @route POST /api/auth/verify-otp
export const verifyOtp = async (req, res, next) => {
    try {
        const { username, otp } = req.body;
        
        if (!username || !otp) {
            return res.status(400).json({ success: false, message: 'Please provide both username and OTP.' });
        }

        const [users] = await db.execute(`
            SELECT u.*, COALESCE(t.full_name, u.username) as name, COALESCE(t.full_name, u.username) as full_name
            FROM users u
            LEFT JOIN teachers t ON u.teacher_id = t.id
            WHERE u.username = ?
        `, [username]);
        
        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }

        const user = users[0];
        
        // Check if account is blocked
        if (user.is_active === 0) {
            return res.status(403).json({ success: false, message: 'Your account has been blocked due to multiple failed attempts. Please contact an Administrator.' });
        }

        if (!user.otp_code || user.otp_code !== otp) {
            // Increment failed attempts for wrong OTP
            const newAttempts = (user.failed_login_attempts || 0) + 1;
            if (newAttempts >= 10) {
                await db.execute('UPDATE users SET is_active = 0, failed_login_attempts = ? WHERE id = ?', [newAttempts, user.id]);
                return res.status(403).json({ success: false, message: 'Your account has been blocked due to multiple failed OTP attempts. Please contact an Administrator.' });
            } else {
                await db.execute('UPDATE users SET failed_login_attempts = ? WHERE id = ?', [newAttempts, user.id]);
                return res.status(401).json({ success: false, message: `Invalid OTP. Attempt ${newAttempts}/10.` });
            }
        }
        
        // Check if OTP is expired (assuming OTP expires at > NOW())
        const [expiredCheck] = await db.execute('SELECT 1 FROM users WHERE id = ? AND otp_expires_at > NOW()', [user.id]);
        if (expiredCheck.length === 0) {
            return res.status(401).json({ success: false, message: 'OTP has expired. Please try logging in again.' });
        }

        // OTP is valid! Clear OTP and update last login
        await db.execute('UPDATE users SET otp_code = NULL, otp_expires_at = NULL, last_login_at = NOW() WHERE id = ?', [user.id]);

        const payload = {
            id: user.id,
            username: user.username,
            name: user.name,
            full_name: user.full_name,
            role: user.role,
            department_id: user.department_id,
            teacher_id: user.teacher_id,
            permissions: user.permissions ? (typeof user.permissions === 'string' ? JSON.parse(user.permissions) : user.permissions) : [],
            accessible_departments: user.accessible_departments ? (typeof user.accessible_departments === 'string' ? JSON.parse(user.accessible_departments) : user.accessible_departments) : []
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });

        // Session cookie: expires when browser is closed (no maxAge/expires)
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict'
            // maxAge intentionally omitted → becomes a session cookie (cleared on browser close)
        });

        // Log the login activity
        try {
            const ipAddress = req.ip || req.connection.remoteAddress || null;
            await db.query(
                `INSERT INTO audit_logs (user_id, action, table_name, record_id, ip_address) VALUES (?, ?, ?, ?, ?)`,
                [user.id, 'login', 'users', user.id, ipAddress]
            );
        } catch (auditErr) {
            console.error("Failed to insert login audit log:", auditErr);
        }

        return res.json({
            success: true,
            token,
            user: payload
        });
    } catch (error) {
        next(error);
    }
};

// @route POST /api/auth/logout
export const logout = async (req, res) => {
    if (req.user) {
        try {
            const ipAddress = req.ip || req.connection.remoteAddress || null;
            await db.query(
                `INSERT INTO audit_logs (user_id, action, table_name, record_id, ip_address) VALUES (?, ?, ?, ?, ?)`,
                [req.user.id, 'logout', 'users', req.user.id, ipAddress]
            );
        } catch (auditErr) {
            console.error("Failed to insert logout audit log:", auditErr);
        }
    }
    res.clearCookie('token');
    return res.json({ success: true, message: 'Logged out successfully.' });
};

// @route GET /api/auth/me
export const getMe = async (req, res, next) => {
    try {
        const [users] = await db.execute(`
            SELECT u.id, u.username, COALESCE(t.full_name, u.username) as name, COALESCE(t.full_name, u.username) as full_name, u.role, u.department_id, u.teacher_id, u.accessible_departments, u.permissions 
            FROM users u
            LEFT JOIN teachers t ON u.teacher_id = t.id
            WHERE u.id = ? AND u.is_active = 1
        `, [req.user.id]);

        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'User not found or inactive.' });
        }

        const user = users[0];
        if(user.accessible_departments && typeof user.accessible_departments === 'string'){
            user.accessible_departments = JSON.parse(user.accessible_departments);
        } else if(!user.accessible_departments) {
            user.accessible_departments = [];
        }
        
        if (user.permissions && typeof user.permissions === 'string') {
            user.permissions = JSON.parse(user.permissions);
        } else if (!user.permissions) {
            user.permissions = [];
        }

        res.json({ success: true, user });
    } catch (error) {
        next(error);
    }
};

// @route POST /api/auth/resend-otp
export const resendOtp = async (req, res, next) => {
    try {
        const { username } = req.body;
        
        if (!username) {
            return res.status(400).json({ success: false, message: 'Username is required.' });
        }

        const [users] = await db.execute(`SELECT id, email, username, is_active FROM users WHERE username = ?`, [username]);
        
        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const user = users[0];

        if (user.is_active === 0) {
            return res.status(403).json({ success: false, message: 'Your account is blocked.' });
        }

        // Generate new OTP
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        await db.execute('UPDATE users SET otp_code = ?, otp_expires_at = DATE_ADD(NOW(), INTERVAL 10 MINUTE) WHERE id = ?', [otpCode, user.id]);
        
        // Send email
        transporter.sendMail({
            from: '"TTMS Security" <support@timetable-aksu.hackvitrasec.com>',
            to: user.email,
            subject: 'Your TTMS Login OTP (Resend)',
            text: `Your new OTP for TTMS login is ${otpCode}. It is valid for 10 minutes. Do not share this code.`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
                    <h2 style="color: #4338ca; margin-bottom: 8px;">🔐 TTMS Login OTP (Resent)</h2>
                    <p style="color: #64748b;">You requested a new OTP. Use the following One-Time Password to complete your login:</p>
                    <div style="background: #f1f5f9; border-radius: 8px; padding: 18px; text-align: center; margin: 16px 0;">
                        <span style="font-size: 2.5rem; font-weight: 800; letter-spacing: 12px; color: #1e1b4b;">${otpCode}</span>
                    </div>
                    <p style="color: #64748b; font-size: 13px;">This OTP is valid for <strong>10 minutes</strong>. Do not share it with anyone.</p>
                </div>
            `
        }).catch((err) => {
            console.error(`[OTP RESEND] Failed for ${user.email}:`, err.message);
            console.warn(`[OTP RESEND FALLBACK] ${otpCode}`);
        });

        res.json({ success: true, message: 'A new OTP has been sent to your email.' });
    } catch (error) {
        next(error);
    }
};
