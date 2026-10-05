import db from '../config/db.js';
import nodemailer from 'nodemailer';
import NotificationService from '../services/NotificationService.js';

// @route   GET /api/settings
export const getSettings = async (req, res, next) => {
    try {
        const [settings] = await db.query('SELECT * FROM settings');
        
        // Convert to key-value object
        const settingsObj = {};
        settings.forEach(s => {
            settingsObj[s.setting_key] = s.setting_value;
        });

        // Attach live SMTP env status (read-only, from .env)
        settingsObj._smtp_configured = !!(
            process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
        );
        settingsObj._smtp_host = process.env.SMTP_HOST || '';
        settingsObj._smtp_user = process.env.SMTP_USER || '';
        settingsObj._smtp_port = process.env.SMTP_PORT || '587';

        res.json({ success: true, data: settingsObj });
    } catch (error) {
        next(error);
    }
};

// @route   PUT /api/settings
// Update multiple settings at once
export const updateSettings = async (req, res, next) => {
    try {
        const updates = req.body; // e.g. { college_name: "ABC", academic_year: "2026-2027" }
        
        // Strip any private/env keys that shouldn't be saved to DB
        const skipKeys = ['_smtp_configured', '_smtp_host', '_smtp_user', '_smtp_port'];
        
        for (const [key, value] of Object.entries(updates)) {
            if (skipKeys.includes(key)) continue;
            // Check if key exists
            const [existing] = await db.query('SELECT id FROM settings WHERE setting_key = ?', [key]);
            if (existing.length > 0) {
                await db.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [value, key]);
            } else {
                await db.query('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)', [key, value]);
            }
        }

        await db.query(`INSERT INTO audit_logs (user_id, action, table_name, new_value) VALUES (?, ?, ?, ?)`, 
            [req.user.id, 'update_settings', 'settings', JSON.stringify(updates)]);

        res.json({ success: true, message: 'Settings updated successfully' });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/settings/test-smtp
// Send a test email using current SMTP config from .env
export const testSmtp = async (req, res, next) => {
    try {
        const { to_email } = req.body;

        if (!to_email) {
            return res.status(400).json({ success: false, message: 'Recipient email (to_email) is required' });
        }

        const smtpHost = process.env.SMTP_HOST;
        const smtpUser = process.env.SMTP_USER;
        const smtpPass = process.env.SMTP_PASS;
        const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);

        if (!smtpHost || !smtpUser || !smtpPass) {
            return res.status(400).json({
                success: false,
                message: 'SMTP is not configured. Please add SMTP_HOST, SMTP_USER, and SMTP_PASS to your .env file and restart the server.'
            });
        }

        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,
            auth: {
                user: smtpUser,
                pass: smtpPass
            },
            tls: { rejectUnauthorized: false }
        });

        // Verify connection first
        await transporter.verify();

        // Send test email
        const mailOptions = {
            from: `"Timetable System" <${smtpUser}>`,
            to: to_email,
            subject: '✅ SMTP Test — Timetable System',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
                    <h2 style="color: #4f46e5; margin-bottom: 16px;">✅ SMTP Configuration Successful</h2>
                    <p style="color: #374151;">This is a test email sent from your <strong>Timetable Management System</strong> to verify that your SMTP settings are working correctly.</p>
                    <hr style="border-color: #e5e7eb; margin: 16px 0;" />
                    <p style="color: #6b7280; font-size: 13px;">Server: <strong>${smtpHost}:${smtpPort}</strong></p>
                    <p style="color: #6b7280; font-size: 13px;">Sent at: <strong>${new Date().toLocaleString()}</strong></p>
                    <p style="color: #6b7280; font-size: 12px; margin-top: 20px;">If you did not expect this email, please ignore it.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);

        await db.query('INSERT INTO audit_logs (user_id, action, table_name, new_value) VALUES (?, ?, ?, ?)',
            [req.user.id, 'smtp_test', 'settings', JSON.stringify({ to: to_email, host: smtpHost })]);

        res.json({ success: true, message: `Test email sent successfully to ${to_email}` });
    } catch (error) {
        console.error('SMTP test error:', error);
        res.status(500).json({
            success: false,
            message: `SMTP test failed: ${error.message}. Please verify your SMTP credentials in .env.`
        });
    }
};

// @route   POST /api/settings/reset-session-assignments
// Clear home_room_id from sections + all section_subjects entries for a given session's classes
export const resetSessionAssignments = async (req, res, next) => {
    try {
        const { session_id } = req.body;

        if (!session_id) {
            return res.status(400).json({ success: false, message: 'session_id is required' });
        }

        // Verify session exists
        const [sessions] = await db.query('SELECT id, name FROM academic_sessions WHERE id = ?', [session_id]);
        if (sessions.length === 0) {
            return res.status(404).json({ success: false, message: 'Session not found' });
        }
        const sessionName = sessions[0].name;

        // Get all section IDs for classes in this session
        const [sections] = await db.query(`
            SELECT s.id as section_id, s.section_name, c.program_name
            FROM sections s
            JOIN classes c ON s.class_id = c.id
            WHERE c.session_id = ?
        `, [session_id]);

        if (sections.length === 0) {
            return res.json({ success: true, message: 'No sections found for this session. Nothing to reset.', details: { sections_reset: 0, allocations_deleted: 0 } });
        }

        const sectionIds = sections.map(s => s.section_id);

        // 1. Clear home_room_id and reset student_strength from sections
        const [roomResult] = await db.query(
            `UPDATE sections SET home_room_id = NULL, student_strength = 0 WHERE id IN (${sectionIds.map(() => '?').join(',')})`,
            sectionIds
        );

        // 2. Delete all teacher-subject allocations (section_subjects) for these sections
        const [allocResult] = await db.query(
            `DELETE FROM section_subjects WHERE section_id IN (${sectionIds.map(() => '?').join(',')})`,
            sectionIds
        );

        const details = {
            session_name: sessionName,
            sections_processed: sectionIds.length,
            home_rooms_cleared: roomResult.affectedRows,
            allocations_deleted: allocResult.affectedRows
        };

        await db.query('INSERT INTO audit_logs (user_id, action, table_name, new_value) VALUES (?, ?, ?, ?)',
            [req.user.id, 'reset_session_assignments', 'sections', JSON.stringify(details)]);

        res.json({
            success: true,
            message: `Session "${sessionName}" assignments reset successfully. ${details.home_rooms_cleared} classroom assignments and ${details.allocations_deleted} teacher/subject allocations cleared.`,
            details
        });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/settings/analyze-duplicates
export const analyzeDuplicates = async (req, res, next) => {
    try {
        let duplicateCounts = {
            teachers: 0,
            classes: 0,
            timetable: 0
        };

        // 1. Count duplicate teachers
        const [teachersResult] = await db.query(`
            SELECT COUNT(t1.id) as count
            FROM teachers t1
            INNER JOIN teachers t2 
            WHERE t1.id > t2.id 
            AND t1.full_name = t2.full_name 
            AND t1.id NOT IN (SELECT teacher_id FROM timetable WHERE teacher_id IS NOT NULL)
        `);
        duplicateCounts.teachers = teachersResult[0]?.count || 0;

        // 2. Count duplicate classes
        const [classesResult] = await db.query(`
            SELECT COUNT(c1.id) as count
            FROM classes c1
            INNER JOIN classes c2 
            WHERE c1.id > c2.id 
            AND c1.program_name = c2.program_name 
            AND c1.semester = c2.semester
            AND (c1.department_id = c2.department_id OR (c1.department_id IS NULL AND c2.department_id IS NULL))
            AND c1.id NOT IN (SELECT class_id FROM sections WHERE class_id IS NOT NULL)
        `);
        duplicateCounts.classes = classesResult[0]?.count || 0;

        // 3. Count duplicate timetable entries
        const [timetableResult] = await db.query(`
            SELECT COUNT(t1.id) as count
            FROM timetable t1
            INNER JOIN timetable t2 
            WHERE t1.id > t2.id 
            AND t1.section_id = t2.section_id 
            AND t1.day_id = t2.day_id 
            AND t1.time_slot_id = t2.time_slot_id
        `);
        duplicateCounts.timetable = timetableResult[0]?.count || 0;

        const totalDuplicates = Object.values(duplicateCounts).reduce((a, b) => a + b, 0);

        res.json({ 
            success: true, 
            message: totalDuplicates > 0 ? `Found ${totalDuplicates} duplicate records.` : 'No duplicate records found.',
            details: duplicateCounts,
            total: totalDuplicates
        });
    } catch (error) {
        next(error);
    }
};

// @route   DELETE /api/settings/cleanup-duplicates
export const cleanupDuplicates = async (req, res, next) => {
    try {
        let deletedCounts = {
            teachers: 0,
            subjects: 0,
            classes: 0,
            timetable: 0
        };

        // 1. Cleanup duplicate teachers (same full_name, keep min id)
        // We only delete if they are not referenced in timetable (to avoid breaking constraints)
        const [teachersResult] = await db.query(`
            DELETE t1 FROM teachers t1
            INNER JOIN teachers t2 
            WHERE t1.id > t2.id 
            AND t1.full_name = t2.full_name 
            AND t1.id NOT IN (SELECT teacher_id FROM timetable WHERE teacher_id IS NOT NULL)
        `);
        deletedCounts.teachers = teachersResult.affectedRows;

        // Subjects cleanup removed as per user request to preserve duplicate subjects

        // 3. Cleanup duplicate classes (same program_name, semester)
        const [classesResult] = await db.query(`
            DELETE c1 FROM classes c1
            INNER JOIN classes c2 
            WHERE c1.id > c2.id 
            AND c1.program_name = c2.program_name 
            AND c1.semester = c2.semester
            AND (c1.department_id = c2.department_id OR (c1.department_id IS NULL AND c2.department_id IS NULL))
            AND c1.id NOT IN (SELECT class_id FROM sections WHERE class_id IS NOT NULL)
        `);
        deletedCounts.classes = classesResult.affectedRows;

        // 4. Cleanup duplicate timetable entries (same day, slot, section, room, etc.)
        const [timetableResult] = await db.query(`
            DELETE t1 FROM timetable t1
            INNER JOIN timetable t2 
            WHERE t1.id > t2.id 
            AND t1.section_id = t2.section_id 
            AND t1.day_id = t2.day_id 
            AND t1.time_slot_id = t2.time_slot_id
        `);
        deletedCounts.timetable = timetableResult.affectedRows;

        const totalDeleted = Object.values(deletedCounts).reduce((a, b) => a + b, 0);

        await db.query('INSERT INTO audit_logs (user_id, action, table_name, new_value) VALUES (?, ?, ?, ?)', 
            [req.user.id, 'cleanup_duplicates', 'system', JSON.stringify(deletedCounts)]);

        res.json({ 
            success: true, 
            message: totalDeleted > 0 ? `Cleaned up ${totalDeleted} duplicate records.` : 'No duplicate records found.',
            details: deletedCounts
        });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/settings/trigger-daily-notifications
export const triggerDailyNotifications = async (req, res, next) => {
    try {
        await NotificationService.sendDailyTimetableNotifications();
        res.json({ success: true, message: 'Daily timetable notifications triggered successfully.' });
    } catch (error) {
        next(error);
    }
};
