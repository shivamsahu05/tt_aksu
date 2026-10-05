import db from '../config/db.js';
import { validationResult } from 'express-validator';

// @route   GET /api/departments
export const getDepartments = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        const offset = (page - 1) * limit;

        let query = 'SELECT d.*, b.name as building_name FROM departments d LEFT JOIN buildings b ON d.building_id = b.id';
        let countQuery = 'SELECT COUNT(*) as total FROM departments d LEFT JOIN buildings b ON d.building_id = b.id';
        const params = [];

        if (search) {
            query += ' WHERE (d.name LIKE ? OR d.short_code LIKE ?)';
            countQuery += ' WHERE (d.name LIKE ? OR d.short_code LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        if (req.departmentId && req.query.all !== 'true') {
            if (params.length > 0) {
                query += ' AND d.id = ?';
                countQuery += ' AND d.id = ?';
            } else {
                query += ' WHERE d.id = ?';
                countQuery += ' WHERE d.id = ?';
            }
            params.push(req.departmentId);
        }

        query += ' ORDER BY d.name ASC LIMIT ? OFFSET ?';
        
        const [countResult] = await db.execute(countQuery, params);
        const totalRows = countResult[0].total;

        // Add limit and offset
        params.push(limit.toString(), offset.toString()); 
        // Note: mysql2 execute treats all params as strings if passing numbers sometimes, 
        // but passing literal numbers is supported if configured, else use cast.
        // Better to use casted numbers:
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

// @route   POST /api/departments
export const createDepartment = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { name, short_code, is_active, building_id } = req.body;
        const active = is_active !== undefined ? is_active : 1;
        const building = building_id || null;

        // Check duplicate short_code
        const [existing] = await db.query('SELECT id FROM departments WHERE short_code = ?', [short_code]);
        if (existing.length > 0) {
            return res.status(409).json({ success: false, message: 'Department short code already exists' });
        }

        const [result] = await db.query(
            'INSERT INTO departments (name, short_code, is_active, building_id) VALUES (?, ?, ?, ?)',
            [name, short_code, active, building]
        );

        res.status(201).json({ success: true, message: 'Department created', id: result.insertId });
    } catch (error) {
        next(error);
    }
};

// @route   PUT /api/departments/:id
export const updateDepartment = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { id } = req.params;
        const { name, short_code, is_active, building_id } = req.body;
        const active = is_active !== undefined ? is_active : 1;
        const building = building_id || null;

        const [existing] = await db.query('SELECT id FROM departments WHERE short_code = ? AND id != ?', [short_code, id]);
        if (existing.length > 0) {
            return res.status(409).json({ success: false, message: 'Department short code already used by another department' });
        }

        await db.query(
            'UPDATE departments SET name = ?, short_code = ?, is_active = ?, building_id = ? WHERE id = ?',
            [name, short_code, active, building, id]
        );

        res.json({ success: true, message: 'Department updated' });
    } catch (error) {
        next(error);
    }
};

// @route   DELETE /api/departments/:id
export const deleteDepartment = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        // Check foreign keys before deleting
        const [teachers] = await db.query('SELECT id FROM teachers WHERE department_id = ? LIMIT 1', [id]);
        if (teachers.length > 0) {
            return res.status(409).json({ success: false, message: 'Cannot delete: Department is used by existing teachers.' });
        }

        const [result] = await db.query('DELETE FROM departments WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Department not found' });
        }

        res.json({ success: true, message: 'Department deleted successfully' });
    } catch (error) {
        // Handle generic foreign key constraint error from MySQL just in case
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(409).json({ success: false, message: 'Cannot delete: Record is referenced elsewhere.' });
        }
        next(error);
    }
};
