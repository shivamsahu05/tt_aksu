import db from '../config/db.js';
import { validationResult } from 'express-validator';

// @route   GET /api/rooms
export const getRooms = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        const building = req.query.building || '';
        const floor = req.query.floor || '';
        const department = req.query.department || '';
        const offset = (page - 1) * limit;

        let query = 'SELECT r.*, r.room_type = "lab" as is_lab, b.name as building, d.name as department_name, d.short_code as department_code, (SELECT COUNT(DISTINCT IFNULL(sec.merge_group_id, sec.id)) FROM sections sec JOIN classes c ON sec.class_id = c.id JOIN academic_sessions sess ON c.session_id = sess.id WHERE sec.home_room_id = r.id AND sess.is_active = 1) as theory_allocation_count, (SELECT COUNT(DISTINCT IFNULL(sec.merge_group_id, sec.id)) FROM section_subjects ss JOIN sections sec ON ss.section_id = sec.id JOIN classes c ON sec.class_id = c.id JOIN academic_sessions sess ON c.session_id = sess.id WHERE ss.room_id = r.id AND sess.is_active = 1) as lab_allocation_count FROM rooms r LEFT JOIN buildings b ON r.building_id = b.id LEFT JOIN departments d ON r.department_id = d.id';
        let countQuery = 'SELECT COUNT(*) as total FROM rooms r LEFT JOIN buildings b ON r.building_id = b.id LEFT JOIN departments d ON r.department_id = d.id';
        const params = [];
        const whereConditions = [];

        if (req.departmentId) {
            whereConditions.push('r.department_id = ?');
            params.push(req.departmentId);
        } else if (department) {
            whereConditions.push('r.department_id = ?');
            params.push(department);
        }

        if (search) {
            whereConditions.push('(r.room_number LIKE ? OR b.name LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }
        
        if (building) {
            whereConditions.push('b.name = ?');
            params.push(building);
        }

        if (floor) {
            if (floor === 'E_PLUS') {
                whereConditions.push('(r.room_number LIKE "E%" OR r.room_number LIKE "F%" OR r.room_number LIKE "G%" OR r.room_number LIKE "H%" OR r.room_number LIKE "I%" OR r.room_number LIKE "J%" OR r.room_number LIKE "K%" OR r.room_number LIKE "L%" OR r.room_number LIKE "6%")');
            } else if (floor === 'OTHER') {
                whereConditions.push('(r.room_number NOT LIKE "A%" AND r.room_number NOT LIKE "B%" AND r.room_number NOT LIKE "C%" AND r.room_number NOT LIKE "D%" AND r.room_number NOT LIKE "E%" AND r.room_number NOT LIKE "F%" AND r.room_number NOT LIKE "G%" AND r.room_number NOT LIKE "H%" AND r.room_number NOT LIKE "I%" AND r.room_number NOT LIKE "J%" AND r.room_number NOT LIKE "K%" AND r.room_number NOT LIKE "L%" AND r.room_number NOT LIKE "6%")');
            } else {
                whereConditions.push('r.room_number LIKE ?');
                params.push(`${floor}%`);
            }
        }

        if (whereConditions.length > 0) {
            const whereClause = ' WHERE ' + whereConditions.join(' AND ');
            query += whereClause;
            countQuery += whereClause;
        }
        
        let statsQuery = countQuery.replace('COUNT(*) as total', `
            COUNT(*) as totalRooms,
            SUM(CASE WHEN r.room_type = "lab" THEN 1 ELSE 0 END) as totalLab,
            SUM(CASE WHEN r.room_type != "lab" THEN 1 ELSE 0 END) as totalTheory,
            SUM(CASE WHEN r.id IN (SELECT home_room_id FROM sections sec JOIN classes c ON sec.class_id = c.id JOIN academic_sessions sess ON c.session_id = sess.id WHERE home_room_id IS NOT NULL AND sess.is_active = 1) OR r.id IN (SELECT room_id FROM section_subjects ss JOIN sections sec ON ss.section_id = sec.id JOIN classes c ON sec.class_id = c.id JOIN academic_sessions sess ON c.session_id = sess.id WHERE room_id IS NOT NULL AND sess.is_active = 1) THEN 1 ELSE 0 END) as assignedRooms,
            SUM(CASE WHEN r.id NOT IN (SELECT home_room_id FROM sections sec JOIN classes c ON sec.class_id = c.id JOIN academic_sessions sess ON c.session_id = sess.id WHERE home_room_id IS NOT NULL AND sess.is_active = 1) AND r.id NOT IN (SELECT room_id FROM section_subjects ss JOIN sections sec ON ss.section_id = sec.id JOIN classes c ON sec.class_id = c.id JOIN academic_sessions sess ON c.session_id = sess.id WHERE room_id IS NOT NULL AND sess.is_active = 1) THEN 1 ELSE 0 END) as unassignedRooms
        `);

        query += ' ORDER BY r.room_number ASC LIMIT ? OFFSET ?';
        
        const [countResult] = await db.execute(countQuery, params);
        const totalRows = countResult[0].total;
        
        const [statsResult] = await db.execute(statsQuery, params);
        const roomStats = {
            total: parseInt(statsResult[0].totalRooms || 0),
            theory: parseInt(statsResult[0].totalTheory || 0),
            lab: parseInt(statsResult[0].totalLab || 0),
            assigned: parseInt(statsResult[0].assignedRooms || 0),
            unassigned: parseInt(statsResult[0].unassignedRooms || 0)
        };

        params.push(limit.toString(), offset.toString()); 
        const [rows] = await db.query(query, params.map(p => isNaN(p) ? p : Number(p)));

        res.json({
            success: true,
            data: rows,
            stats: roomStats,
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

// @route   GET /api/rooms/buildings
export const getBuildings = async (req, res, next) => {
    try {
        const [rows] = await db.query('SELECT id, name FROM buildings ORDER BY name ASC');
        const [mappings] = await db.query('SELECT DISTINCT building_id, department_id FROM rooms WHERE department_id IS NOT NULL');
        
        const data = rows.map(b => {
            const depts = mappings.filter(m => m.building_id === b.id).map(m => m.department_id);
            return { ...b, department_ids: depts };
        });

        res.json({
            success: true,
            data: data
        });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/rooms
export const createRoom = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { room_number, building, capacity, is_lab, is_active, is_smart_room } = req.body;
        const active = is_active !== undefined ? is_active : 1;
        const lab = is_lab !== undefined ? is_lab : 0;
        const smart = is_smart_room !== undefined ? (is_smart_room ? 1 : 0) : 0;

        const buildingName = building || 'Main Block';
        let [existingBuilding] = await db.query('SELECT id FROM buildings WHERE name = ?', [buildingName]);
        let building_id;
        if (existingBuilding.length > 0) {
            building_id = existingBuilding[0].id;
        } else {
            const [bRes] = await db.query('INSERT INTO buildings (name) VALUES (?)', [buildingName]);
            building_id = bRes.insertId;
        }

        const final_department_id = req.departmentId || req.body.department_id || null;

        const [existing] = await db.query('SELECT id FROM rooms WHERE room_number = ? AND building_id = ? AND (department_id = ? OR department_id IS NULL)', [room_number, building_id, final_department_id]);
        if (existing.length > 0) {
            return res.status(409).json({ success: false, message: 'Room number already exists in this building' });
        }

        const [result] = await db.query(
            'INSERT INTO rooms (building_id, room_number, capacity, room_type, is_active, department_id, is_smart_room) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [building_id, room_number, capacity, lab ? 'lab' : 'theory', active, final_department_id, smart]
        );

        res.status(201).json({ success: true, message: 'Room created', id: result.insertId });
    } catch (error) {
        next(error);
    }
};

// @route   PUT /api/rooms/:id
export const updateRoom = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { id } = req.params;
        const { room_number, building, capacity, is_lab, is_active, department_id, is_smart_room } = req.body;
        const active = is_active !== undefined ? is_active : 1;
        const lab = is_lab !== undefined ? is_lab : 0;
        const smart = is_smart_room !== undefined ? (is_smart_room ? 1 : 0) : 0;
        const final_department_id = req.departmentId || department_id || null;

        const buildingName = building || 'Main Block';
        let [existingBuilding] = await db.query('SELECT id FROM buildings WHERE name = ?', [buildingName]);
        let building_id;
        if (existingBuilding.length > 0) {
            building_id = existingBuilding[0].id;
        } else {
            const [bRes] = await db.query('INSERT INTO buildings (name) VALUES (?)', [buildingName]);
            building_id = bRes.insertId;
        }

        const [existing] = await db.query('SELECT id FROM rooms WHERE room_number = ? AND building_id = ? AND id != ? AND (department_id = ? OR department_id IS NULL)', [room_number, building_id, id, final_department_id]);
        if (existing.length > 0) {
            return res.status(409).json({ success: false, message: 'Room number already exists in this building' });
        }

        await db.query(
            'UPDATE rooms SET room_number = ?, building_id = ?, capacity = ?, room_type = ?, is_active = ?, department_id = ?, is_smart_room = ? WHERE id = ?',
            [room_number, building_id, capacity, lab ? 'lab' : 'theory', active, final_department_id, smart, id]
        );

        res.json({ success: true, message: 'Room updated' });
    } catch (error) {
        next(error);
    }
};

// @route   DELETE /api/rooms/:id
export const deleteRoom = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        const [timetable] = await db.query('SELECT id FROM timetable WHERE room_id = ? LIMIT 1', [id]);
        if (timetable.length > 0) {
            return res.status(409).json({ success: false, message: 'Cannot delete: Room is used in the timetable.' });
        }

        const [result] = await db.query('DELETE FROM rooms WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Room not found' });
        }

        res.json({ success: true, message: 'Room deleted successfully' });
    } catch (error) {
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(409).json({ success: false, message: 'Cannot delete: Record is referenced elsewhere.' });
        }
        next(error);
    }
};

import fs from 'fs';
import xlsx from 'xlsx';

// @route   POST /api/rooms/bulk
export const bulkUploadRooms = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        let results = [];
        const errors = [];
        
        // Fetch existing buildings to minimize inserts
        const [buildings] = await db.query('SELECT id, name FROM buildings');
        const buildingMap = {};
        buildings.forEach(b => {
            buildingMap[b.name.trim().toLowerCase()] = b.id;
        });

        // Fetch departments for Department Code lookup
        const [depts] = await db.query('SELECT id, name, short_code FROM departments');
        const deptMap = {};
        depts.forEach(d => {
            if (d.name) deptMap[d.name.trim().toLowerCase()] = d.id;
            if (d.short_code) deptMap[d.short_code.trim().toLowerCase()] = d.id;
            if (d.name) deptMap[d.name.trim().toLowerCase().replace(/[^a-z0-9]/g, '')] = d.id;
            if (d.short_code) deptMap[d.short_code.trim().toLowerCase().replace(/[^a-z0-9]/g, '')] = d.id;
            deptMap[d.id.toString()] = d.id;
        });

        // Parse CSV/Excel
        try {
            const workbook = xlsx.readFile(req.file.path);
            const sheetName = workbook.SheetNames[0];
            results = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
        } catch (e) {
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(400).json({ success: false, message: 'Failed to parse file. Please upload a valid CSV or Excel file.' });
        }

        let successCount = 0;
        let skippedCount = 0;

        for (let i = 0; i < results.length; i++) {
                    const row = results[i];
                    const rowIndex = i + 2; 
                    
                    try {
                        const roomNumber = row['Room Number']?.toString().trim();
                        const buildingName = row['Building']?.toString().trim() || 'Main Block';
                        const capacityStr = row['Capacity']?.toString().trim();
                        const typeStr = (row['Type'] || row['Type (theory/lab/both)'])?.toString().trim().toLowerCase();

                        if (!roomNumber || !capacityStr) {
                            errors.push(`Row ${rowIndex}: Missing required fields (Room Number, Capacity)`);
                            continue;
                        }

                        const capacity = parseInt(capacityStr);
                        if (isNaN(capacity) || capacity < 1) {
                            errors.push(`Row ${rowIndex}: Capacity must be at least 1.`);
                            continue;
                        }

                        let type = 'theory';
                        if (typeStr && ['theory', 'lab', 'both'].includes(typeStr)) {
                            type = typeStr === 'both' ? 'theory' : typeStr; // fallback 'both' to 'theory' or handle as needed
                        } else if (typeStr) {
                            errors.push(`Row ${rowIndex}: Invalid Type '${typeStr}'. Must be theory or lab.`);
                            continue;
                        }

                        let buildingId = buildingMap[buildingName.toLowerCase()];
                        if (!buildingId) {
                            const [bRes] = await db.query('INSERT INTO buildings (name) VALUES (?)', [buildingName]);
                            buildingId = bRes.insertId;
                            buildingMap[buildingName.toLowerCase()] = buildingId;
                        }

                        const deptName = (row['Department Code'] || row['Department'] || row['Department Short Name'] || row['Department Short Code'] || row['Dept Code'] || row['Dept'] || row['department_code'] || row['department'])?.toString().trim();
                        let finalDeptId = req.departmentId || null;
                        if (!finalDeptId && deptName) {
                            const normalizedDept = deptName.toLowerCase();
                            const strippedDept = normalizedDept.replace(/[^a-z0-9]/g, '');
                            finalDeptId = deptMap[normalizedDept] || deptMap[strippedDept];
                            if (!finalDeptId) {
                                const availableCodes = depts.map(d => d.short_code || d.name).filter(Boolean).join(', ');
                                errors.push(`Row ${rowIndex}: Department '${deptName}' not found. Valid codes: ${availableCodes}`);
                                continue;
                            }
                        } else if (req.departmentId && deptName) {
                            const normalizedDept = deptName.toLowerCase();
                            const strippedDept = normalizedDept.replace(/[^a-z0-9]/g, '');
                            const resolvedDeptId = deptMap[normalizedDept] || deptMap[strippedDept];
                            if (resolvedDeptId) {
                                finalDeptId = resolvedDeptId;
                            }
                        }

                        // Duplicate check
                        const [existing] = await db.query('SELECT id FROM rooms WHERE room_number = ? AND building_id = ?', [roomNumber, buildingId]);
                        if (existing.length > 0) {
                            errors.push(`Row ${rowIndex}: Room '${roomNumber}' in building '${buildingName}' already exists.`);
                            skippedCount++;
                            continue;
                        }

                        await db.query(
                            'INSERT INTO rooms (room_number, building_id, capacity, room_type, is_active, department_id) VALUES (?, ?, ?, ?, ?, ?)',
                            [roomNumber, buildingId, capacity, type, 1, finalDeptId]
                        );
                        
                        successCount++;
                    } catch (err) {
                        errors.push(`Row ${rowIndex}: Server error - ${err.message}`);
                    }
                }

        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            summary: { total: results.length, inserted: successCount, skipped: skippedCount, errors: errors.length },
            message: `Bulk upload complete. Successfully added ${successCount} rooms.`,
            errors: errors.length > 0 ? errors : null
        });

    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        next(error);
    }
};

// @route   POST /api/rooms/bulk-delete
export const deleteRoomsByDepartment = async (req, res, next) => {
    try {
        const { department_ids } = req.body;
        
        let deptIds = [];
        let hasNull = false;
        
        if (req.departmentId) {
            deptIds = [req.departmentId];
        } else if (Array.isArray(department_ids) && department_ids.length > 0) {
            deptIds = department_ids.filter(id => id !== 'null' && id !== null);
            if (department_ids.includes('null') || department_ids.includes(null)) {
                hasNull = true;
            }
        }

        if (deptIds.length === 0 && !hasNull) {
            return res.status(400).json({ success: false, message: 'Department IDs are required' });
        }

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            let whereClause = '';
            const queryParams = [];

            if (deptIds.length > 0 && hasNull) {
                const placeholders = deptIds.map(() => '?').join(',');
                whereClause = `(r.department_id IN (${placeholders}) OR r.department_id IS NULL)`;
                queryParams.push(...deptIds);
            } else if (deptIds.length > 0) {
                const placeholders = deptIds.map(() => '?').join(',');
                whereClause = `r.department_id IN (${placeholders})`;
                queryParams.push(...deptIds);
            } else if (hasNull) {
                whereClause = `r.department_id IS NULL`;
            }

            // Check if any rooms are used in section_subjects
            const [usedInSubjects] = await connection.query(
                `SELECT COUNT(*) as count FROM section_subjects ss JOIN rooms r ON ss.room_id = r.id WHERE ${whereClause}`, 
                queryParams
            );
            
            // Check if any rooms are used as home rooms
            const [usedAsHome] = await connection.query(
                `SELECT COUNT(*) as count FROM sections s JOIN rooms r ON s.home_room_id = r.id WHERE ${whereClause}`, 
                queryParams
            );

            if (usedInSubjects[0].count > 0 || usedAsHome[0].count > 0) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({ 
                    success: false, 
                    message: 'Cannot delete rooms. Some rooms are currently assigned to subjects or sections in the timetable.' 
                });
            }

            // Remove 'r.' prefix for the DELETE query
            const deleteWhereClause = whereClause.replace(/r\./g, '');
            const [result] = await connection.query(`DELETE FROM rooms WHERE ${deleteWhereClause}`, queryParams);
            await connection.commit();
            connection.release();

            res.json({
                success: true,
                message: `Successfully deleted ${result.affectedRows} rooms.`
            });
        } catch (err) {
            await connection.rollback();
            connection.release();
            throw err;
        }
    } catch (error) {
        next(error);
    }
};
