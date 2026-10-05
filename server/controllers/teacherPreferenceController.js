import db from '../config/db.js';

export const getTeacherPreferences = async (req, res, next) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query('SELECT * FROM teacher_preferences WHERE teacher_id = ?', [id]);
        
        res.json({
            success: true,
            data: rows
        });
    } catch (error) {
        next(error);
    }
};
export const getDepartmentTeacherPreferences = async (req, res, next) => {
    try {
        const { deptId } = req.params;
        let query = `
            SELECT p.*, t.full_name, t.designation, t.short_name 
            FROM teacher_preferences p 
            JOIN teachers t ON p.teacher_id = t.id 
        `;
        let params = [];
        if (deptId && deptId !== 'all') {
            query += 'WHERE t.department_id = ?';
            params.push(deptId);
        }
        
        const [rows] = await db.query(query, params);
        
        res.json({
            success: true,
            data: rows
        });
    } catch (error) {
        next(error);
    }
};

export const updateTeacherPreferences = async (req, res, next) => {
    const connection = await db.getConnection();
    try {
        const { id } = req.params;
        const { preferences } = req.body; // Array of {day_id, time_slot_id, preference_type}

        await connection.beginTransaction();

        // Remove old preferences
        await connection.query('DELETE FROM teacher_preferences WHERE teacher_id = ?', [id]);

        // Insert new preferences
        if (preferences && preferences.length > 0) {
            const values = preferences.map(p => [
                id,
                p.day_id,
                p.time_slot_id,
                p.preference_type || 'preferred'
            ]);

            await connection.query(`
                INSERT INTO teacher_preferences (teacher_id, day_id, time_slot_id, preference_type) 
                VALUES ?
            `, [values]);
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Preferences updated successfully'
        });
    } catch (error) {
        await connection.rollback();
        next(error);
    } finally {
        connection.release();
    }
};
