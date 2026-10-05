import db from '../config/db.js';

// @route   GET /api/audit
export const getAuditLogs = async (req, res, next) => {
    try {
        const { limit = 100, offset = 0, table_name } = req.query;
        let query = `
            SELECT a.*, u.username 
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.id
        `;
        const params = [];

        if (table_name) {
            query += ' WHERE a.table_name = ?';
            params.push(table_name);
        }

        query += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
        params.push(Number(limit), Number(offset));

        const [logs] = await db.query(query, params);
        res.json({ success: true, data: logs });
    } catch (error) {
        next(error);
    }
};
