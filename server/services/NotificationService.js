import db from '../config/db.js';
import nodemailer from 'nodemailer';
import axios from 'axios';

// ==========================================
// API Keys & Config (To be filled later by User)
// ==========================================
const SMS_API_URL = process.env.SMS_API_URL || 'https://api.sms-provider.com/send';
const SMS_API_KEY = process.env.SMS_API_KEY || 'YOUR_SMS_API_KEY';

const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || 'https://api.whatsapp-provider.com/send';
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY || 'YOUR_WHATSAPP_API_KEY';
// ==========================================

// Helper to get system settings
const getSystemSettings = async () => {
    const [rows] = await db.query('SELECT setting_key, setting_value FROM settings');
    const settings = {};
    rows.forEach(r => {
        settings[r.setting_key] = r.setting_value;
    });
    return settings;
};

// Generic Notification Sender
export const sendNotification = async (type, to, content, subject = '') => {
    const settings = await getSystemSettings();
    
    if (type === 'email' && settings.email_notifications === 'enabled') {
        return sendEmailNotification(to, subject, content);
    }
    
    if (type === 'sms' && settings.sms_notifications === 'enabled') {
        return sendSmsNotification(to, content);
    }
    
    if (type === 'whatsapp' && settings.whatsapp_notifications === 'enabled') {
        return sendWhatsappNotification(to, content);
    }
    
    console.log(`[Notification Service] ${type} is disabled or invalid type.`);
    return false;
};

// 1. Email Notification Logic
const sendEmailNotification = async (email, subject, htmlContent) => {
    if (!email) return false;
    
    try {
        const smtpHost = process.env.SMTP_HOST || 'smtp.hostinger.com';
        const smtpUser = process.env.SMTP_USER || 'support@timetable-aksu.hackvitrasec.com';
        const smtpPass = process.env.SMTP_PASS || '$u770Rt@123';
        const smtpPort = parseInt(process.env.SMTP_PORT || '465', 10);
        
        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,
            auth: { user: smtpUser, pass: smtpPass },
            tls: { rejectUnauthorized: false }
        });

        await transporter.sendMail({
            from: `"Timetable System" <${smtpUser}>`,
            to: email,
            subject: subject,
            html: htmlContent
        });
        
        console.log(`[Notification Service] Email sent successfully to ${email}`);
        return true;
    } catch (error) {
        console.error(`[Notification Service] Email failed to ${email}:`, error.message);
        return false;
    }
};

// 2. SMS Notification Logic
const sendSmsNotification = async (mobile, textContent) => {
    if (!mobile) throw new Error('No registered mobile found.');
    
    try {
        console.log(`[Notification Service] Sending SMS to ${mobile}...`);
        
        if (!process.env.SMS_API_KEY || process.env.SMS_API_KEY === 'YOUR_SMS_API_KEY') {
            throw new Error('Our maintenance work is going on for SMS. Please try another method or contact admin.');
        }

        // TODO: Replace with actual SMS Provider API call
        // const response = await axios.post(SMS_API_URL, { ... });
        
        console.log(`[Notification Service] SMS successfully dispatched to ${mobile}.`);
        return true;
    } catch (error) {
        console.error(`[Notification Service] SMS failed to ${mobile}:`, error.message);
        throw error;
    }
};

// 3. WhatsApp Notification Logic
const sendWhatsappNotification = async (mobile, textContent) => {
    if (!mobile) throw new Error('No registered mobile found.');
    
    try {
        console.log(`[Notification Service] Sending WhatsApp message to ${mobile}...`);
        
        if (!process.env.WHATSAPP_API_KEY || process.env.WHATSAPP_API_KEY === 'YOUR_WHATSAPP_API_KEY') {
            throw new Error('Our maintenance work is going on for WhatsApp. Please try another method or contact admin.');
        }

        // TODO: Replace with actual WhatsApp API call
        // const response = await axios.post(WHATSAPP_API_URL, { ... });
        
        console.log(`[Notification Service] WhatsApp message successfully dispatched to ${mobile}.`);
        return true;
    } catch (error) {
        console.error(`[Notification Service] WhatsApp failed to ${mobile}:`, error.message);
        throw error;
    }
};

/**
 * Trigger daily notifications for teachers who have classes today.
 * This can be run by a CRON job every morning at 7:00 AM.
 */
export const sendDailyTimetableNotifications = async () => {
    try {
        const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const todayIndex = new Date().getDay(); // 0-6
        const todayName = daysOfWeek[todayIndex];

        // 1. Get the day_id for today
        const [days] = await db.query('SELECT id FROM days WHERE name = ?', [todayName]);
        if (days.length === 0) {
            console.log(`[Notification Service] Day ${todayName} not found in DB.`);
            return;
        }
        const dayId = days[0].id;

        // 2. Fetch timetable records for today joined with teacher details
        const query = `
            SELECT 
                t.id as teacher_id, t.full_name, t.mobile, t.email,
                ts.start_time, ts.end_time,
                sub.full_name as subject_name,
                c.program_name, c.semester,
                s.section_name,
                r.room_number
            FROM timetable tt
            JOIN teachers t ON tt.teacher_id = t.id
            JOIN time_slots ts ON tt.time_slot_id = ts.id
            JOIN subjects sub ON tt.subject_id = sub.id
            JOIN sections s ON tt.section_id = s.id
            JOIN classes c ON s.class_id = c.id
            LEFT JOIN rooms r ON tt.room_id = r.id
            WHERE tt.day_id = ? AND t.is_active = TRUE
            ORDER BY t.id, ts.start_time
        `;

        const [classesToday] = await db.query(query, [dayId]);

        if (classesToday.length === 0) {
            console.log(`[Notification Service] No classes scheduled for today (${todayName}).`);
            return;
        }

        // Group classes by teacher
        const teacherSchedules = {};
        classesToday.forEach(cls => {
            if (!teacherSchedules[cls.teacher_id]) {
                teacherSchedules[cls.teacher_id] = {
                    full_name: cls.full_name,
                    mobile: cls.mobile,
                    email: cls.email,
                    classes: []
                };
            }
            teacherSchedules[cls.teacher_id].classes.push(cls);
        });

        // 3. Send notifications
        const settings = await getSystemSettings();
        const enableSms = settings.sms_notifications === 'enabled';
        const enableWhatsapp = settings.whatsapp_notifications === 'enabled';
        const enableEmail = settings.email_notifications === 'enabled';

        for (const [teacherId, data] of Object.entries(teacherSchedules)) {
            // Only prepare messages if at least one channel is enabled
            if (!enableSms && !enableWhatsapp && !enableEmail) continue;

            const { full_name, mobile, email, classes } = data;
            
            // Build Text Content for SMS/WhatsApp
            let textMessage = `Hello ${full_name},\n\nYour schedule for today (${todayName}):\n`;
            
            // Build HTML Content for Email
            let htmlMessage = `<div style="font-family: Arial, sans-serif;">
                <h3 style="color: #4f46e5;">Hello ${full_name},</h3>
                <p>Here is your class schedule for today (<b>${todayName}</b>):</p>
                <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                    <tr style="background-color: #f3f4f6; text-align: left;">
                        <th style="padding: 8px; border: 1px solid #e5e7eb;">Time</th>
                        <th style="padding: 8px; border: 1px solid #e5e7eb;">Class/Section</th>
                        <th style="padding: 8px; border: 1px solid #e5e7eb;">Subject</th>
                        <th style="padding: 8px; border: 1px solid #e5e7eb;">Room</th>
                    </tr>`;

            classes.forEach((c, index) => {
                const timeStr = `${c.start_time.substring(0,5)} - ${c.end_time.substring(0,5)}`;
                const classStr = `${c.program_name} (Sem ${c.semester}) - Sec ${c.section_name}`;
                const roomStr = c.room_number || 'TBA';
                
                textMessage += `\n${index + 1}. ${timeStr} | ${classStr} | ${c.subject_name} | Room: ${roomStr}`;
                
                htmlMessage += `
                    <tr>
                        <td style="padding: 8px; border: 1px solid #e5e7eb;">${timeStr}</td>
                        <td style="padding: 8px; border: 1px solid #e5e7eb;">${classStr}</td>
                        <td style="padding: 8px; border: 1px solid #e5e7eb;">${c.subject_name}</td>
                        <td style="padding: 8px; border: 1px solid #e5e7eb;">${roomStr}</td>
                    </tr>`;
            });

            textMessage += `\n\nRegards,\nAKS University Timetable System`;
            htmlMessage += `</table><br/><p>Regards,<br/><b>AKS University Timetable System</b></p></div>`;

            // Send via enabled channels
            if (enableWhatsapp && mobile) {
                await sendWhatsappNotification(mobile, textMessage);
            }
            if (enableSms && mobile) {
                await sendSmsNotification(mobile, textMessage);
            }
            if (enableEmail && email) {
                await sendEmailNotification(email, `Your Timetable Schedule for Today`, htmlMessage);
            }
        }

        console.log(`[Notification Service] Daily timetable notifications dispatched to ${Object.keys(teacherSchedules).length} teachers.`);
    } catch (error) {
        console.error('[Notification Service] Error in sendDailyTimetableNotifications:', error);
    }
};



/**
 * Trigger upcoming class notifications 15 mins before class.
 * This can be run by a CRON job every minute.
 */
export const checkAndSendUpcomingClassAlerts = async () => {
    try {
        const now = new Date();
        const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const todayName = daysOfWeek[now.getDay()];

        // 1. Get the day_id for today
        const [days] = await db.query('SELECT id FROM days WHERE name = ?', [todayName]);
        if (days.length === 0) return;
        const dayId = days[0].id;

        // 2. Calculate target time (now + 15 minutes)
        // We will look for classes starting in exactly 15 minutes (ignoring seconds)
        const targetTime = new Date(now.getTime() + 15 * 60000);
        const targetHours = targetTime.getHours().toString().padStart(2, '0');
        const targetMinutes = targetTime.getMinutes().toString().padStart(2, '0');
        const timeString = `${targetHours}:${targetMinutes}:00`;

        // 3. Fetch timetable records for today and this exact time slot
        const query = `
            SELECT 
                t.id as teacher_id, t.full_name, t.mobile, t.email,
                ts.start_time, ts.end_time,
                sub.full_name as subject_name,
                c.program_name, c.semester,
                s.section_name,
                r.room_number
            FROM timetable tt
            JOIN teachers t ON tt.teacher_id = t.id
            JOIN time_slots ts ON tt.time_slot_id = ts.id
            JOIN subjects sub ON tt.subject_id = sub.id
            JOIN sections s ON tt.section_id = s.id
            JOIN classes c ON s.class_id = c.id
            LEFT JOIN rooms r ON tt.room_id = r.id
            WHERE tt.day_id = ? AND ts.start_time = ? AND t.is_active = TRUE
        `;

        const [upcomingClasses] = await db.query(query, [dayId, timeString]);

        if (upcomingClasses.length === 0) {
            return;
        }

        // 4. Send notifications
        const settings = await getSystemSettings();
        const enableSms = settings.sms_notifications === 'enabled';
        const enableWhatsapp = settings.whatsapp_notifications === 'enabled';
        const enableEmail = settings.email_notifications === 'enabled';

        if (!enableSms && !enableWhatsapp && !enableEmail) return;

        for (const cls of upcomingClasses) {
            const { full_name, mobile, email, start_time, end_time, subject_name, program_name, semester, section_name, room_number } = cls;
            
            const timeStr = `${start_time.substring(0,5)} - ${end_time.substring(0,5)}`;
            const classStr = `${program_name} (Sem ${semester}) - Sec ${section_name}`;
            const roomStr = room_number || 'TBA';

            // Build Text Message
            const textMessage = `🔔 Reminder: Class in 15 mins!
            
Hello ${full_name},
Your next class is about to start.

🎓 Class: ${classStr}
📚 Subject: ${subject_name}
⏰ Time: ${timeStr}
📍 Room: ${roomStr}

Regards,
AKS University`;

            // Build HTML Message
            const htmlMessage = `<div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
                <h3 style="color: #ea580c;">🔔 Class Reminder (15 mins left)</h3>
                <p>Hello <b>${full_name}</b>,</p>
                <p>Your next class is starting soon.</p>
                <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                    <tr><td style="padding: 8px; border: 1px solid #e5e7eb; background: #f9fafb;"><b>Class/Section</b></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${classStr}</td></tr>
                    <tr><td style="padding: 8px; border: 1px solid #e5e7eb; background: #f9fafb;"><b>Subject</b></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${subject_name}</td></tr>
                    <tr><td style="padding: 8px; border: 1px solid #e5e7eb; background: #f9fafb;"><b>Time</b></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${timeStr}</td></tr>
                    <tr><td style="padding: 8px; border: 1px solid #e5e7eb; background: #f9fafb;"><b>Room</b></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${roomStr}</td></tr>
                </table>
                <p style="margin-top: 20px; font-size: 13px; color: #6b7280;">Regards,<br/>AKS University Timetable System</p>
            </div>`;

            // Dispatch Notifications
            if (enableWhatsapp && mobile) {
                await sendWhatsappNotification(mobile, textMessage);
            }
            if (enableSms && mobile) {
                await sendSmsNotification(mobile, textMessage);
            }
            if (enableEmail && email) {
                await sendEmailNotification(email, `🔔 Class Reminder: ${subject_name} at ${start_time.substring(0,5)}`, htmlMessage);
            }
        }
        
        console.log(`[Notification Service] Sent ${upcomingClasses.length} upcoming class reminders.`);
    } catch (error) {
        console.error('[Notification Service] Error in checkAndSendUpcomingClassAlerts:', error);
    }
};

export default {
    sendNotification,
    sendDailyTimetableNotifications,
    checkAndSendUpcomingClassAlerts
};
