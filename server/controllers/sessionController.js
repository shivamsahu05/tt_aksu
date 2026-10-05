import db from '../config/db.js';
import { validationResult } from 'express-validator';

// @route   GET /api/sessions
export const getSessions = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        const offset = (page - 1) * limit;

        let query = 'SELECT * FROM academic_sessions';
        let countQuery = 'SELECT COUNT(*) as total FROM academic_sessions';
        const params = [];

        if (search) {
            query += ' WHERE name LIKE ?';
            countQuery += ' WHERE name LIKE ?';
            params.push(`%${search}%`);
        }

        query += ' ORDER BY start_date DESC LIMIT ? OFFSET ?';
        
        const [countResult] = await db.execute(countQuery, params);
        const totalRows = countResult[0].total;

        params.push(limit.toString(), offset.toString()); 
        const [rows] = await db.query(query, params.map(p => isNaN(p) ? p : Number(p)));

        res.json({
            success: true,
            data: rows,
            pagination: {
                page,
                limit,
                totalRows,
                totalPages: Math.ceil(totalRows / limit)
            }
        });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/sessions
export const createSession = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { name, start_date, end_date, is_active } = req.body;
        const active = is_active !== undefined ? is_active : 1;

        if (active) {
            // Deactivate other sessions if this one is active
            await db.query('UPDATE academic_sessions SET is_active = 0');
        }

        const [result] = await db.query(
            'INSERT INTO academic_sessions (name, start_date, end_date, is_active) VALUES (?, ?, ?, ?)',
            [name, start_date, end_date, active]
        );

        res.status(201).json({ success: true, message: 'Academic Session created', id: result.insertId });
    } catch (error) {
        next(error);
    }
};

// @route   PUT /api/sessions/:id
export const updateSession = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { id } = req.params;
        const { name, start_date, end_date, is_active } = req.body;
        const active = is_active !== undefined ? is_active : 1;

        if (active) {
            // Deactivate other sessions if this one is active
            await db.query('UPDATE academic_sessions SET is_active = 0 WHERE id != ?', [id]);
        }

        await db.query(
            'UPDATE academic_sessions SET name = ?, start_date = ?, end_date = ?, is_active = ? WHERE id = ?',
            [name, start_date, end_date, active, id]
        );

        res.json({ success: true, message: 'Academic Session updated' });
    } catch (error) {
        next(error);
    }
};

// @route   DELETE /api/sessions/:id
export const deleteSession = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        // Check foreign keys
        const [classes] = await db.query('SELECT id FROM classes WHERE session_id = ? LIMIT 1', [id]);
        if (classes.length > 0) {
            return res.status(409).json({ success: false, message: 'Cannot delete: Session is used by classes.' });
        }
        
        const [timetable] = await db.query('SELECT id FROM timetable WHERE session_id = ? LIMIT 1', [id]);
        if (timetable.length > 0) {
            return res.status(409).json({ success: false, message: 'Cannot delete: Session has generated timetable entries.' });
        }

        const [result] = await db.query('DELETE FROM academic_sessions WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Session not found' });
        }

        res.json({ success: true, message: 'Academic Session deleted successfully' });
    } catch (error) {
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(409).json({ success: false, message: 'Cannot delete: Record is referenced elsewhere.' });
        }
        next(error);
    }
};
