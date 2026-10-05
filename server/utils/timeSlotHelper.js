import db from '../config/db.js';

/**
 * Fetches time slots for a specific department.
 * If the department has no custom time slots, it falls back to global time slots (department_id IS NULL).
 * @param {number|null} departmentId 
 * @param {boolean} excludeBreaks
 * @returns {Promise<Array>} Array of time slots
 */
export const getTimeSlotsForDepartment = async (departmentId = null, excludeBreaks = false) => {
    const breakCondition = excludeBreaks ? ` AND slot_type != 'break'` : '';
    
    let query = `SELECT * FROM time_slots WHERE (department_id IS NULL`;
    let params = [];
    
    if (departmentId) {
        query += ` OR department_id = ?`;
        params.push(departmentId);
    }
    query += `) ${breakCondition} ORDER BY slot_order ASC`;

    const [rows] = await db.query(query, params);

    if (!departmentId) {
        return rows;
    }

    const slotMap = new Map();
    rows.forEach(row => {
        if (!slotMap.has(row.slot_order)) {
            slotMap.set(row.slot_order, row);
        } else {
            // Replace if this row belongs to the specific department (overriding the common one)
            if (row.department_id == departmentId) {
                slotMap.set(row.slot_order, row);
            }
        }
    });

    const finalRows = Array.from(slotMap.values());
    finalRows.sort((a, b) => a.slot_order - b.slot_order);
    return finalRows;
};
