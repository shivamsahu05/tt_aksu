import db from '../config/db.js';
import ConflictEngine from '../services/ConflictEngine.js'; // Assuming ConflictEngine exists in services

// Helper to notify
const notify = async (userId, title, message, type) => {
    await db.query(
        'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
        [userId, title, message, type]
    );
};

// @route   GET /api/replacements
export const getReplacements = async (req, res, next) => {
    try {
        const { leave_id } = req.query;
        let query = `
            SELECT r.*, t_sub.full_name as substitute_name, t_abs.full_name as absent_teacher,
                   l.leave_start, l.leave_end, d.name as day_name, ts.start_time, ts.end_time
            FROM timetable_replacements r
            JOIN teacher_leaves l ON r.leave_id = l.id
            JOIN teachers t_abs ON l.teacher_id = t_abs.id
            JOIN teachers t_sub ON r.substitute_teacher_id = t_sub.id
            LEFT JOIN days d ON r.day_id = d.id
            LEFT JOIN time_slots ts ON r.time_slot_id = ts.id
        `;
        const params = [];

        if (leave_id) {
            query += ' WHERE r.leave_id = ?';
            params.push(leave_id);
        }

        query += ' ORDER BY r.created_at DESC';

        const [replacements] = await db.query(query, params);
        res.json({ success: true, data: replacements });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/replacements/suggestions
// Suggests free teachers for a specific day and timeslot
export const suggestSubstitutes = async (req, res, next) => {
    try {
        const { session_id, day_id, time_slot_id, absent_teacher_id } = req.query;

        if (!session_id || !day_id || !time_slot_id) {
            return res.status(400).json({ success: false, message: 'Missing required parameters' });
        }

        // Get all active teachers except absent one and exclude 'Class Teacher' entries
        const [teachers] = await db.query(`
            SELECT id, full_name, short_name, designation 
            FROM teachers 
            WHERE is_active = 1 AND id != ?
              AND LOWER(full_name) NOT LIKE '%class teacher%' 
              AND LOWER(short_name) NOT LIKE '%class teacher%'
              AND LOWER(IFNULL(designation, '')) NOT LIKE '%class teacher%'
        `, [absent_teacher_id]);

        const suggestions = [];

        // Simple check: Is the teacher busy in the timetable or already acting as a substitute?
        for (let t of teachers) {
            const [busy] = await db.query(`
                SELECT id FROM timetable 
                WHERE session_id = ? AND teacher_id = ? AND day_id = ? AND time_slot_id = ? AND status = 'active'
            `, [session_id, t.id, day_id, time_slot_id]);

            const [substituteBusy] = await db.query(`
                SELECT r.id FROM timetable_replacements r
                JOIN teacher_leaves l ON r.leave_id = l.id
                WHERE r.substitute_teacher_id = ? AND r.day_id = ? AND r.time_slot_id = ? AND r.status = 'approved'
                AND l.leave_start <= CURDATE() AND l.leave_end >= CURDATE()
            `, [t.id, day_id, time_slot_id]); // Simplified date check for current substitution

            if (busy.length === 0 && substituteBusy.length === 0) {
                // Get workload (count of classes)
                const [workload] = await db.query(`
                    SELECT COUNT(*) as count FROM timetable WHERE session_id = ? AND teacher_id = ? AND status = 'active'
                `, [session_id, t.id]);

                suggestions.push({
                    ...t,
                    current_workload: workload[0].count
                });
            }
        }

        // Sort by lowest workload
        suggestions.sort((a, b) => a.current_workload - b.current_workload);

        res.json({ success: true, data: suggestions });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/replacements/daily-suggestions
// Suggests free teachers for all absent teachers on a specific date
export const getDailySuggestions = async (req, res, next) => {
    try {
        const { date, session_id } = req.query;
        if (!date || !session_id) {
            return res.status(400).json({ success: false, message: 'Missing required parameters' });
        }

        const parts = date.split('-').map(Number);
        const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayName = dayNames[dateObj.getDay()];

        // Find the day_id
        const [dayRows] = await db.query('SELECT id FROM days WHERE name = ? OR name LIKE ? LIMIT 1', [dayName, dayName + '%']);
        if (dayRows.length === 0) return res.json({ success: true, data: [] });
        const day_id = dayRows[0].id;

        // Find all teachers on leave on this date (approved or pending)
        const [leaves] = await db.query(`
            SELECT l.id as leave_id, l.teacher_id, t.full_name as teacher_name
            FROM teacher_leaves l
            JOIN teachers t ON l.teacher_id = t.id
            WHERE LOWER(l.status) IN ('approved', 'pending') 
              AND DATE(l.leave_start) <= ? 
              AND DATE(l.leave_end) >= ?
        `, [date, date]);

        const result = [];

        // For each absent teacher, find their classes and suggest substitutes
        for (let leave of leaves) {
            let [classes] = await db.query(`
                SELECT tt.id as timetable_id, tt.time_slot_id, tt.day_id, tt.section_id, tt.subject_id,
                       sub.subject_code, sub.full_name as subject_name,
                       ts.start_time, ts.end_time, ts.slot_order,
                       cls.program_name, cls.semester, sec.section_name
                FROM timetable tt
                JOIN subjects sub ON tt.subject_id = sub.id
                JOIN time_slots ts ON tt.time_slot_id = ts.id
                JOIN sections sec ON tt.section_id = sec.id
                JOIN classes cls ON sec.class_id = cls.id
                WHERE tt.teacher_id = ? AND tt.day_id = ? AND tt.session_id = ? AND tt.status = 'active'
                ORDER BY ts.slot_order ASC
            `, [leave.teacher_id, day_id, session_id]);

            if (classes.length === 0) {
                [classes] = await db.query(`
                    SELECT tt.id as timetable_id, tt.time_slot_id, tt.day_id, tt.section_id, tt.subject_id,
                           sub.subject_code, sub.full_name as subject_name,
                           ts.start_time, ts.end_time, ts.slot_order,
                           cls.program_name, cls.semester, sec.section_name
                    FROM timetable tt
                    JOIN subjects sub ON tt.subject_id = sub.id
                    JOIN time_slots ts ON tt.time_slot_id = ts.id
                    JOIN sections sec ON tt.section_id = sec.id
                    JOIN classes cls ON sec.class_id = cls.id
                    WHERE tt.teacher_id = ? AND tt.day_id = ? AND tt.status = 'active'
                    ORDER BY ts.slot_order ASC
                `, [leave.teacher_id, day_id]);
            }

            if (classes.length === 0) continue;

            const missingClasses = [];

            for (let cls of classes) {
                // Check if already replaced
                const [replacementsByLeave] = await db.query(`
                    SELECT r.id, t.full_name as substitute_name 
                    FROM timetable_replacements r
                    JOIN teachers t ON r.substitute_teacher_id = t.id
                    WHERE r.leave_id = ? AND r.time_slot_id = ? AND r.day_id = ?
                `, [leave.leave_id, cls.time_slot_id, day_id]);

                const isReplaced = replacementsByLeave.length > 0;
                let suggestions = [];

                if (!isReplaced) {
                    // Find available teachers
                    const [availableTeachers] = await db.query(`
                        SELECT t.id, t.full_name, t.short_name, t.designation,
                        (SELECT COUNT(*) FROM timetable WHERE teacher_id = t.id AND status = 'active') as current_workload
                    FROM teachers t
                        WHERE t.is_active = 1 AND t.id != ?
                          AND LOWER(t.full_name) NOT LIKE '%class teacher%'
                          AND LOWER(t.short_name) NOT LIKE '%class teacher%'
                          AND LOWER(IFNULL(t.designation, '')) NOT LIKE '%class teacher%'
                          AND t.id NOT IN (
                              SELECT teacher_id FROM teacher_leaves 
                              WHERE LOWER(status) IN ('approved', 'pending') AND DATE(leave_start) <= ? AND DATE(leave_end) >= ?
                          )
                          AND t.id NOT IN (
                              SELECT teacher_id FROM timetable 
                              WHERE day_id = ? AND time_slot_id = ? AND status = 'active'
                          )
                          AND t.id NOT IN (
                              SELECT r.substitute_teacher_id FROM timetable_replacements r
                              JOIN teacher_leaves l ON r.leave_id = l.id
                              WHERE r.day_id = ? AND r.time_slot_id = ? AND r.status = 'approved'
                                AND DATE(l.leave_start) <= ? AND DATE(l.leave_end) >= ?
                          )
                        ORDER BY current_workload ASC
                    `, [leave.teacher_id, date, date, day_id, cls.time_slot_id, day_id, cls.time_slot_id, date, date]);
                    
                    suggestions = availableTeachers;
                }

                missingClasses.push({
                    ...cls,
                    is_replaced: isReplaced,
                    substitute_name: isReplaced ? replacementsByLeave[0].substitute_name : null,
                    suggestions
                });
            }

            result.push({
                leave_id: leave.leave_id,
                teacher_id: leave.teacher_id,
                teacher_name: leave.teacher_name,
                missing_classes: missingClasses
            });
        }

        res.json({ success: true, data: result, day_id });

    } catch (error) {
        console.error("Error in daily-suggestions:", error);
        res.status(500).json({ success: false, message: error.message, stack: error.stack });
    }
};

export const assignReplacement = async (req, res, next) => {
    try {
        let { leave_id, substitute_teacher_id, timetable_id, day_id, time_slot_id, absent_teacher_id, date } = req.body;

        // If leave_id is missing, auto-create a 1-day leave for the absent teacher
        if (!leave_id && absent_teacher_id && date) {
            const [leaveResult] = await db.query(`
                INSERT INTO teacher_leaves (teacher_id, leave_start, leave_end, reason, status)
                VALUES (?, ?, ?, 'Auto-generated for daily engagement', 'approved')
            `, [absent_teacher_id, date, date]);
            leave_id = leaveResult.insertId;
        }

        if (!leave_id) {
            return res.status(400).json({ success: false, message: 'leave_id is required or absent_teacher_id and date must be provided.' });
        }

        // Check if substitute is already busy (conflict validation)
        const [busy] = await db.query(`
            SELECT id FROM timetable 
            WHERE teacher_id = ? AND day_id = ? AND time_slot_id = ? AND status = 'active'
        `, [substitute_teacher_id, day_id, time_slot_id]);

        if (busy.length > 0) {
            return res.status(409).json({ success: false, message: 'Conflict: Substitute is already teaching a class at this time.' });
        }

        const [result] = await db.query(`
            INSERT INTO timetable_replacements (leave_id, substitute_teacher_id, timetable_id, day_id, time_slot_id, status)
            VALUES (?, ?, ?, ?, ?, 'approved')
        `, [leave_id, substitute_teacher_id, timetable_id, day_id, time_slot_id]);

        await db.query(`INSERT INTO audit_logs (user_id, action, table_name, record_id, new_value) VALUES (?, ?, ?, ?, ?)`, 
            [req.user.id, 'assign_replacement', 'timetable_replacements', result.insertId, JSON.stringify(req.body)]);

        // Notify Substitute
        const [subUser] = await db.query('SELECT u.id FROM users u JOIN teachers t ON u.email = t.email WHERE t.id = ?', [substitute_teacher_id]);
        if (subUser.length > 0) {
            await notify(subUser[0].id, 'Substitution Assigned', `You have been assigned as a substitute.`, 'timetable');
        }

        res.status(201).json({ success: true, message: 'Replacement assigned successfully' });
    } catch (error) {
        next(error);
    }
};

// @route   PUT /api/replacements/:id/status
export const updateReplacementStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // 'approved', 'rejected'

        await db.query('UPDATE timetable_replacements SET status = ? WHERE id = ?', [status, id]);
        
        await db.query(`INSERT INTO audit_logs (user_id, action, table_name, record_id, new_value) VALUES (?, ?, ?, ?, ?)`, 
            [req.user.id, 'update_replacement_status', 'timetable_replacements', id, JSON.stringify({ status })]);

        res.json({ success: true, message: `Replacement ${status} successfully` });
    } catch (error) {
        next(error);
    }
};

// @route   DELETE /api/replacements/:id
export const deleteReplacement = async (req, res, next) => {
    try {
        const { id } = req.params;

        const [existing] = await db.query('SELECT * FROM timetable_replacements WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Replacement not found.' });
        }

        await db.query('DELETE FROM timetable_replacements WHERE id = ?', [id]);
        
        await db.query(`INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value) VALUES (?, ?, ?, ?, ?)`, 
            [req.user.id, 'delete_replacement', 'timetable_replacements', id, JSON.stringify(existing[0])]);

        res.json({ success: true, message: 'Replacement cleared successfully.' });
    } catch (error) {
        next(error);
    }
};

// @route   DELETE /api/replacements/daily/all
export const deleteDailyReplacements = async (req, res, next) => {
    try {
        const { date, department_id } = req.query;
        if (!date) {
            return res.status(400).json({ success: false, message: 'date is required' });
        }

        const dateObj = new Date(date);
        const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
        
        const [dayResult] = await db.query('SELECT id FROM days WHERE name = ? OR name LIKE ? LIMIT 1', [dayName, dayName + '%']);
        if (dayResult.length === 0) {
            return res.json({ success: true, message: 'No replacements found to clear.' });
        }
        const day_id = dayResult[0].id;

        let query = 'SELECT r.id FROM timetable_replacements r';
        let params = [];
        
        if (department_id) {
            query += ` 
                JOIN timetable t ON r.timetable_id = t.id 
                JOIN sections sec ON t.section_id = sec.id 
                JOIN classes c ON sec.class_id = c.id 
                WHERE c.department_id = ? AND r.day_id = ?
            `;
            params.push(department_id, day_id);
        } else {
            query += ' WHERE r.day_id = ?';
            params.push(day_id);
        }

        const [replacements] = await db.query(query, params);
        if (replacements.length === 0) {
            return res.json({ success: true, message: 'No engagements found to clear for this date.' });
        }

        const idsToDelete = replacements.map(r => r.id);
        
        await db.query(`DELETE FROM timetable_replacements WHERE id IN (?)`, [idsToDelete]);
        
        await db.query(`INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value) VALUES (?, ?, ?, ?, ?)`, 
            [req.user.id, 'delete_daily_replacements', 'timetable_replacements', null, JSON.stringify({ ids: idsToDelete, date, department_id })]);

        res.json({ success: true, message: `Cleared ${idsToDelete.length} engagements successfully.` });
    } catch (error) {
        next(error);
    }
};
