import db from '../config/db.js';

// Helper to notify
const notify = async (userId, title, message, type) => {
    await db.query(
        'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
        [userId, title, message, type]
    );
};

// @route   GET /api/leaves
export const getLeaves = async (req, res, next) => {
    try {
        const { status, teacher_id } = req.query;
        let query = `
            SELECT l.*, t.full_name as teacher_name, u.username as approver_name
            FROM teacher_leaves l
            JOIN teachers t ON l.teacher_id = t.id
            LEFT JOIN users u ON l.approved_by = u.id
        `;
        const params = [];
        const conditions = [];

        if (status) {
            conditions.push('l.status = ?');
            params.push(status);
        }
        
        // If faculty, only see own leaves. If admin, see all (or filtered by teacher_id)
        if (req.user.role === 'FACULTY') {
            const [teacher] = await db.query('SELECT id FROM teachers WHERE email = ? LIMIT 1', [req.user.email]);
            if (teacher.length > 0) {
                conditions.push('l.teacher_id = ?');
                params.push(teacher[0].id);
            } else {
                return res.json({ success: true, data: [] });
            }
        } else if (teacher_id) {
            conditions.push('l.teacher_id = ?');
            params.push(teacher_id);
        }

        if (req.departmentId) {
            conditions.push('t.department_id = ?');
            params.push(req.departmentId);
        } else if (req.query.department_id) {
            conditions.push('t.department_id = ?');
            params.push(req.query.department_id);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        
        query += ' ORDER BY l.applied_at DESC';

        const [leaves] = await db.query(query, params);
        res.json({ success: true, data: leaves });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/leaves
export const applyLeave = async (req, res, next) => {
    try {
        const { leave_start, leave_end, reason } = req.body;
        
        let targetTeacherId = req.body.teacher_id;
        
        // Auto-resolve teacher ID for faculty
        if (req.user.role === 'FACULTY') {
            const [teacher] = await db.query('SELECT id FROM teachers WHERE email = ? LIMIT 1', [req.user.email]);
            if (teacher.length === 0) return res.status(400).json({ success: false, message: 'Faculty profile not found' });
            targetTeacherId = teacher[0].id;
        }

        const [result] = await db.query(`
            INSERT INTO teacher_leaves (teacher_id, leave_start, leave_end, reason, status)
            VALUES (?, ?, ?, ?, 'approved')
        `, [targetTeacherId, leave_start, leave_end, reason]);

        await db.query(`INSERT INTO audit_logs (user_id, action, table_name, record_id, new_value) VALUES (?, ?, ?, ?, ?)`, 
            [req.user.id, 'apply_leave', 'teacher_leaves', result.insertId, JSON.stringify({ leave_start, leave_end })]);

        res.status(201).json({ success: true, message: 'Leave applied successfully' });
    } catch (error) {
        next(error);
    }
};

// @route   PUT /api/leaves/:id/status
// Body: status ('approved', 'rejected')
export const updateLeaveStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!['approved', 'rejected', 'canceled'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const [leave] = await db.query('SELECT l.*, t.email, t.department_id FROM teacher_leaves l JOIN teachers t ON l.teacher_id = t.id WHERE l.id = ?', [id]);
        if (leave.length === 0) {
            return res.status(404).json({ success: false, message: 'Leave not found' });
        }
        
        if (req.departmentId && leave[0].department_id !== req.departmentId) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        await db.query(`
            UPDATE teacher_leaves SET status = ?, approved_by = ? WHERE id = ?
        `, [status, req.user.id, id]);

        await db.query(`INSERT INTO audit_logs (user_id, action, table_name, record_id, new_value) VALUES (?, ?, ?, ?, ?)`, 
            [req.user.id, 'update_leave_status', 'teacher_leaves', id, JSON.stringify({ status })]);

        // Notify Faculty
        const [facultyUser] = await db.query('SELECT id FROM users WHERE email = ?', [leave[0].email]);
        if (facultyUser.length > 0) {
            await notify(facultyUser[0].id, `Leave ${status}`, `Your leave application has been ${status}.`, 'leave');
        }

        res.json({ success: true, message: `Leave ${status} successfully` });
    } catch (error) {
        next(error);
    }
};

// @route   PUT /api/leaves/:id
export const updateLeave = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { leave_start, leave_end, reason, teacher_id } = req.body;

        const [leave] = await db.query('SELECT l.*, t.department_id FROM teacher_leaves l JOIN teachers t ON l.teacher_id = t.id WHERE l.id = ?', [id]);
        if (leave.length === 0) return res.status(404).json({ success: false, message: 'Leave not found' });
        
        if (req.departmentId && leave[0].department_id !== req.departmentId) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        await db.query(`
            UPDATE teacher_leaves 
            SET teacher_id = ?, leave_start = ?, leave_end = ?, reason = ?
            WHERE id = ?
        `, [teacher_id, leave_start, leave_end, reason, id]);

        await db.query(`INSERT INTO audit_logs (user_id, action, table_name, record_id, new_value) VALUES (?, ?, ?, ?, ?)`, 
            [req.user.id, 'update_leave', 'teacher_leaves', id, JSON.stringify({ leave_start, leave_end })]);

        res.json({ success: true, message: 'Leave updated successfully' });
    } catch (error) {
        next(error);
    }
};

// @route   DELETE /api/leaves/:id
export const deleteLeave = async (req, res, next) => {
    try {
        const { id } = req.params;

        const [leave] = await db.query('SELECT l.*, t.department_id FROM teacher_leaves l JOIN teachers t ON l.teacher_id = t.id WHERE l.id = ?', [id]);
        if (leave.length === 0) return res.status(404).json({ success: false, message: 'Leave not found' });
        
        if (req.departmentId && leave[0].department_id !== req.departmentId) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        await db.query('DELETE FROM teacher_leaves WHERE id = ?', [id]);

        await db.query(`INSERT INTO audit_logs (user_id, action, table_name, record_id, new_value) VALUES (?, ?, ?, ?, ?)`, 
            [req.user.id, 'delete_leave', 'teacher_leaves', id, JSON.stringify({ deleted: true })]);

        res.json({ success: true, message: 'Leave deleted successfully' });
    } catch (error) {
        next(error);
    }
};
