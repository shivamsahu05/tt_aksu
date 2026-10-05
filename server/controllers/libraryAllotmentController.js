import db from '../config/db.js';

export const getAllotments = async (req, res) => {
    try {
        const { session_id, department_id } = req.query;
        let query = `
            SELECT la.*, s.name as session_name, d.name as department_name
            FROM library_allotments la
            JOIN academic_sessions s ON la.session_id = s.id
            JOIN departments d ON la.department_id = d.id
            WHERE 1=1
        `;
        const params = [];

        if (session_id) {
            query += ' AND la.session_id = ?';
            params.push(session_id);
        }

        if (req.user.role === 'DEPARTMENT_ADMIN') {
            const deptId = req.departmentId || req.user.department_id;
            query += ' AND la.department_id = ?';
            params.push(deptId);
        } else if (department_id) {
            query += ' AND la.department_id = ?';
            params.push(department_id);
        }

        query += ' ORDER BY la.created_at DESC';

        const [allotments] = await db.query(query, params);

        // Fetch classes separately and map
        const [classes] = await db.query('SELECT id, semester, program_name FROM classes');
        const allotmentsWithClasses = allotments.map(allotment => {
            const classIds = (allotment.class_ids || '').split(',').map(Number);
            const matchedClasses = classes.filter(c => classIds.includes(c.id));
            const classesDisplay = matchedClasses.map(c => `${c.semester} ${c.program_name}`).join(', ');
            return {
                ...allotment,
                classes_display: classesDisplay
            };
        });

        res.json(allotmentsWithClasses);
    } catch (error) {
        console.error('Error fetching library allotments:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

export const createAllotment = async (req, res) => {
    try {
        const { session_id, department_id, class_ids, days, start_time, end_time } = req.body;
        
        let finalDeptId = department_id;
        if (req.user.role === 'DEPARTMENT_ADMIN') {
            finalDeptId = req.departmentId || req.user.department_id;
        }

        if (!session_id || !finalDeptId || !class_ids || !days || class_ids.length === 0 || days.length === 0) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const classIdsStr = class_ids.join(',');
        const daysStr = days.join(',');

        const [result] = await db.query(
            'INSERT INTO library_allotments (session_id, department_id, class_ids, days, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)',
            [session_id, finalDeptId, classIdsStr, daysStr, start_time || null, end_time || null]
        );

        res.status(201).json({ message: 'Library allotment created successfully', id: result.insertId });
    } catch (error) {
        console.error('Error creating library allotment:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

export const updateAllotment = async (req, res) => {
    try {
        const { id } = req.params;
        const { session_id, department_id, class_ids, days, start_time, end_time } = req.body;
        
        let finalDeptId = department_id;
        if (req.user.role === 'DEPARTMENT_ADMIN') {
            finalDeptId = req.departmentId || req.user.department_id;
            
            // verify ownership
            const [existing] = await db.query('SELECT department_id FROM library_allotments WHERE id = ?', [id]);
            if (existing.length === 0 || existing[0].department_id !== finalDeptId) {
                return res.status(403).json({ message: 'Forbidden' });
            }
        }

        if (!class_ids || !days || class_ids.length === 0 || days.length === 0) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const classIdsStr = class_ids.join(',');
        const daysStr = days.join(',');

        await db.query(
            'UPDATE library_allotments SET session_id = ?, department_id = ?, class_ids = ?, days = ?, start_time = ?, end_time = ? WHERE id = ?',
            [session_id, finalDeptId, classIdsStr, daysStr, start_time || null, end_time || null, id]
        );

        res.json({ message: 'Library allotment updated successfully' });
    } catch (error) {
        console.error('Error updating library allotment:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

export const deleteAllotment = async (req, res) => {
    try {
        const { id } = req.params;

        if (req.user.role === 'DEPARTMENT_ADMIN') {
            const deptId = req.departmentId || req.user.department_id;
            const [existing] = await db.query('SELECT department_id FROM library_allotments WHERE id = ?', [id]);
            if (existing.length === 0 || existing[0].department_id !== deptId) {
                return res.status(403).json({ message: 'Forbidden' });
            }
        }

        await db.query('DELETE FROM library_allotments WHERE id = ?', [id]);
        res.json({ message: 'Library allotment deleted successfully' });
    } catch (error) {
        console.error('Error deleting library allotment:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
