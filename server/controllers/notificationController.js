import db from '../config/db.js';

export const getNotifications = async (req, res, next) => {
    try {
        const [notifications] = await db.query(
            'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
            [req.user.id]
        );
        res.json({ success: true, data: notifications });
    } catch (error) {
        next(error);
    }
};

export const markAsRead = async (req, res, next) => {
    try {
        const { id } = req.params;
        await db.query(
            'UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?',
            [id, req.user.id]
        );
        res.json({ success: true, message: 'Notification marked as read' });
    } catch (error) {
        next(error);
    }
};

export const markAllAsRead = async (req, res, next) => {
    try {
        await db.query(
            'UPDATE notifications SET is_read = TRUE WHERE user_id = ?',
            [req.user.id]
        );
        res.json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
        next(error);
    }
};

export const checkReminders = async (req, res, next) => {
    try {
        if (!req.user.teacher_id) {
            return res.json({ success: true, message: 'Not a teacher' });
        }

        const now = new Date();
        const currentTimeString = now.toTimeString().split(' ')[0]; // HH:MM:SS
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayName = dayNames[now.getDay()];

        const [dayResult] = await db.query('SELECT id FROM days WHERE name = ?', [dayName]);
        if (dayResult.length === 0) return res.json({ success: true, message: 'No classes today' });
        const day_id = dayResult[0].id;

        // Fetch today's classes for the teacher
        const [classes] = await db.query(`
            SELECT t.id, t.session_id, sub.full_name as subject_name, 
                   c.program_name, sec.section_name, r.room_number,
                   s.start_time, s.end_time
            FROM timetable t
            JOIN time_slots s ON t.time_slot_id = s.id
            JOIN subjects sub ON t.subject_id = sub.id
            JOIN sections sec ON t.section_id = sec.id
            JOIN classes c ON sec.class_id = c.id
            LEFT JOIN rooms r ON t.room_id = r.id
            WHERE t.teacher_id = ? AND t.day_id = ? AND t.status = 'active'
        `, [req.user.teacher_id, day_id]);

        let newRemindersCount = 0;

        for (const cls of classes) {
            const startParts = cls.start_time.split(':');
            const startMinutes = parseInt(startParts[0]) * 60 + parseInt(startParts[1]);
            const diff = startMinutes - currentMinutes;

            // If class starts in <= 20 minutes and is still in the future
            if (diff > 0 && diff <= 20) {
                // Check if we already created a notification for this class today
                const title = 'Upcoming Class Reminder';
                const message = `Your class for ${cls.subject_name} (${cls.program_name} - ${cls.section_name}) in ${cls.room_number || 'TBD'} starts at ${cls.start_time}.`;
                
                const [existing] = await db.query(`
                    SELECT id FROM notifications 
                    WHERE user_id = ? AND title = ? AND DATE(created_at) = CURRENT_DATE() AND message = ?
                `, [req.user.id, title, message]);

                if (existing.length === 0) {
                    await db.query(`
                        INSERT INTO notifications (user_id, title, message, type)
                        VALUES (?, ?, ?, ?)
                    `, [req.user.id, title, message, 'reminder']);
                    newRemindersCount++;
                }
            }
        }

        res.json({ success: true, message: `Checked reminders. Generated ${newRemindersCount} new reminders.` });
    } catch (error) {
        console.error(error);
        next(error);
    }
};

export const deleteAllNotifications = async (req, res, next) => {
    try {
        await db.query(
            'DELETE FROM notifications WHERE user_id = ?',
            [req.user.id]
        );
        res.json({ success: true, message: 'All notifications cleared' });
    } catch (error) {
        next(error);
    }
};
