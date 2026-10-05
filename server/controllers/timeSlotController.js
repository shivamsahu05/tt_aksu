import db from '../config/db.js';
import { validationResult } from 'express-validator';

// @route   GET /api/timeslots
export const getTimeSlots = async (req, res, next) => {
    try {
        let query = `
            SELECT ts.*, d.name as department_name 
            FROM time_slots ts
            LEFT JOIN departments d ON ts.department_id = d.id
        `;
        let params = [];

        if (req.user.role === 'DEPARTMENT_ADMIN') {
            query += ' WHERE ts.department_id = ? OR ts.department_id IS NULL';
            params.push(req.user.department_id);
        } else if (req.query.department_id && req.query.department_id !== 'common') {
            query += ' WHERE ts.department_id = ? OR ts.department_id IS NULL';
            params.push(req.query.department_id);
        } else {
            // Admin viewing global slots or all slots
            query += ' WHERE ts.department_id IS NULL';
        }

        query += ' ORDER BY ts.slot_order ASC';

        const [rows] = await db.query(query, params);

        let finalRows = rows;
        // If fetching for a specific department (either by role or by query), deduplicate by slot_order
        if (req.user.role === 'DEPARTMENT_ADMIN' || (req.query.department_id && req.query.department_id !== 'common')) {
            const deptId = req.user.role === 'DEPARTMENT_ADMIN' ? req.user.department_id : req.query.department_id;
            const slotMap = new Map();
            
            rows.forEach(row => {
                if (!slotMap.has(row.slot_order)) {
                    slotMap.set(row.slot_order, row);
                } else {
                    // Replace if this row belongs to the specific department (overriding the common one)
                    if (row.department_id == deptId) {
                        slotMap.set(row.slot_order, row);
                    }
                }
            });
            
            finalRows = Array.from(slotMap.values());
            finalRows.sort((a, b) => a.slot_order - b.slot_order);
        }

        res.json({ success: true, data: finalRows });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/timeslots
export const createTimeSlot = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { slot_order, start_time, end_time, slot_type } = req.body;
        let department_id = req.body.department_id || null;

        if (req.user.role === 'DEPARTMENT_ADMIN') {
            department_id = req.user.department_id;
        }

        const queryParams = [slot_order, department_id];
        let existQuery = 'SELECT id FROM time_slots WHERE slot_order = ? AND ';
        if (department_id) {
            existQuery += 'department_id = ?';
        } else {
            existQuery += 'department_id IS NULL';
            queryParams.pop(); // remove null
        }

        const [existing] = await db.query(existQuery, queryParams);
        if (existing.length > 0) {
            return res.status(409).json({ success: false, message: 'A time slot with this order already exists for this department.' });
        }

        const [result] = await db.query(
            'INSERT INTO time_slots (slot_order, start_time, end_time, slot_type, department_id) VALUES (?, ?, ?, ?, ?)',
            [slot_order, start_time, end_time, slot_type, department_id]
        );

        res.status(201).json({ success: true, message: 'Time slot created successfully', id: result.insertId });
    } catch (error) {
        next(error);
    }
};

// @route   PUT /api/timeslots/:id
export const updateTimeSlot = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { id } = req.params;
        const { slot_order, start_time, end_time, slot_type } = req.body;
        let department_id = req.body.department_id || null;

        if (req.user.role === 'DEPARTMENT_ADMIN') {
            department_id = req.user.department_id;
        }

        // Check if slot_order is taken by another slot in the SAME department
        const queryParams = [slot_order, id];
        let existQuery = 'SELECT id FROM time_slots WHERE slot_order = ? AND id != ? AND ';
        if (department_id) {
            existQuery += 'department_id = ?';
            queryParams.push(department_id);
        } else {
            existQuery += 'department_id IS NULL';
        }

        const [existing] = await db.query(existQuery, queryParams);
        if (existing.length > 0) {
            return res.status(409).json({ success: false, message: 'A time slot with this order already exists for this department.' });
        }

        const updateParams = [slot_order, start_time, end_time, slot_type, department_id, id];
        let updateQuery = 'UPDATE time_slots SET slot_order = ?, start_time = ?, end_time = ?, slot_type = ?, department_id = ? WHERE id = ?';
        
        if (req.user.role === 'DEPARTMENT_ADMIN') {
            updateQuery += ' AND department_id = ?';
            updateParams.push(req.user.department_id);
        }

        const [result] = await db.query(updateQuery, updateParams);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Time slot not found' });
        }

        res.json({ success: true, message: 'Time slot updated successfully' });
    } catch (error) {
        next(error);
    }
};

// @route   DELETE /api/timeslots/:id
export const deleteTimeSlot = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        let query = 'DELETE FROM time_slots WHERE id = ?';
        let params = [id];

        if (req.user.role === 'DEPARTMENT_ADMIN') {
            query += ' AND department_id = ?';
            params.push(req.user.department_id);
        }

        const [result] = await db.query(query, params);
        
        if (result.affectedRows > 0) {
            res.json({ success: true, message: 'Time slot deleted successfully' });
        } else {
            res.status(404).json({ success: false, message: 'Time slot not found' });
        }
    } catch (error) {
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(409).json({ success: false, message: 'Cannot delete time slot because it is used in the timetable.' });
        }
        next(error);
    }
};
