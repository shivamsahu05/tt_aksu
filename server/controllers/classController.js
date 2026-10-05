import db from '../config/db.js';
import { validationResult } from 'express-validator';
import fs from 'fs';
import xlsx from 'xlsx';

// @route   GET /api/classes
export const getClasses = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        let department_id = req.query.department_id;
        if (req.departmentId) {
            department_id = req.departmentId;
        }
        const session_id = req.query.session_id;
        const offset = (page - 1) * limit;

        let query = `
            SELECT c.*, 
                   d.name as department_name, d.short_code as department_code,
                   s.name as session_name, s.is_active as session_active,
                   b.name as building_name,
                   (SELECT COUNT(*) FROM sections WHERE class_id = c.id) as section_count,
                   (SELECT COALESCE(SUM(student_strength), 0) FROM sections WHERE class_id = c.id) as total_strength,
                   (SELECT GROUP_CONCAT(CONCAT(section_name, ':', mode)) FROM sections WHERE class_id = c.id) as section_details
            FROM classes c
            JOIN departments d ON c.department_id = d.id
            JOIN academic_sessions s ON c.session_id = s.id
            LEFT JOIN buildings b ON c.building_id = b.id
        `;
        let countQuery = `
            SELECT 
                COUNT(*) as total,
                SUM(IF(c.is_active=1, 1, 0)) as active_count,
                SUM(IF(c.is_active=0, 1, 0)) as inactive_count,
                SUM(IF((SELECT COUNT(*) FROM class_electives WHERE class_id = c.id) > 0, 1, 0)) as with_electives_count
            FROM classes c
        `;
        const params = [];
        const whereConditions = [];

        if (search) {
            whereConditions.push('(c.program_name LIKE ?)');
            params.push(`%${search}%`);
        }
        
        if (department_id) {
            whereConditions.push('c.department_id = ?');
            params.push(department_id);
        }

        if (session_id) {
            whereConditions.push('c.session_id = ?');
            params.push(session_id);
        }

        if (whereConditions.length > 0) {
            const whereClause = ' WHERE ' + whereConditions.join(' AND ');
            query += whereClause;
            countQuery += whereClause;
        }

        query += ' ORDER BY s.start_date DESC, c.semester ASC, c.program_name ASC LIMIT ? OFFSET ?';
        
        const [countResult] = await db.query(countQuery, params);
        const totalRows = countResult[0].total || 0;
        const activeCount = countResult[0].active_count || 0;
        const inactiveCount = countResult[0].inactive_count || 0;
        const withElectivesCount = countResult[0].with_electives_count || 0;

        params.push(limit.toString(), offset.toString()); 
        const [rows] = await db.query(query, params.map(p => isNaN(p) ? p : Number(p)));

        res.json({
            success: true,
            data: rows,
            overview: {
                total: totalRows,
                active: activeCount,
                inactive: inactiveCount,
                withElectives: withElectivesCount
            },
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

// @route   GET /api/classes/all-sections
export const getAllSections = async (req, res, next) => {
    try {
        let { department_id, session_id } = req.query;
        if (req.departmentId) {
            department_id = req.departmentId;
        }
        let query = `
            SELECT sec.id, sec.section_name, sec.student_strength, sec.home_room_id, sec.mode, sec.merge_group_id,
                   c.id as class_id, c.program_name, c.semester, c.department_id, c.session_id, c.building_id as class_building_id,
                   d.name as department_name, d.short_code as department_short_code,
                   s.name as session_name,
                   r.room_number, r.capacity, r.building_id as room_building_id,
                   b.name as room_building_name
            FROM sections sec
            JOIN classes c ON sec.class_id = c.id
            LEFT JOIN departments d ON c.department_id = d.id
            LEFT JOIN academic_sessions s ON c.session_id = s.id
            LEFT JOIN rooms r ON sec.home_room_id = r.id
            LEFT JOIN buildings b ON r.building_id = b.id
            WHERE 1=1 AND c.is_active = 1
        `;
        const params = [];
        
        if (department_id) {
            query += ' AND c.department_id = ?';
            params.push(department_id);
        }
        if (session_id) {
            query += ' AND c.session_id = ?';
            params.push(session_id);
        }
        
        query += ' ORDER BY c.semester ASC, c.program_name ASC, sec.section_name ASC';
        
        const [rows] = await db.query(query, params);
        res.json({ success: true, data: rows });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/classes/:id
export const getClassById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const [classRows] = await db.query(`
            SELECT c.*, d.name as department_name, s.name as session_name 
            FROM classes c
            JOIN departments d ON c.department_id = d.id
            JOIN academic_sessions s ON c.session_id = s.id
            WHERE c.id = ?
        `, [id]);

        if (classRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Class not found' });
        }
        if (req.departmentId && classRows[0].department_id !== req.departmentId) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        const [sections] = await db.query(`
            SELECT s.*, r.room_number 
            FROM sections s 
            LEFT JOIN rooms r ON s.home_room_id = r.id 
            WHERE s.class_id = ?
            ORDER BY s.section_name ASC
        `, [id]);

        const [electives] = await db.query(`
            SELECT subject_id FROM class_electives WHERE class_id = ?
        `, [id]);

        res.json({
            success: true,
            data: {
                ...classRows[0],
                sections,
                elective_subject_ids: electives.map(e => e.subject_id)
            }
        });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/classes
export const createClass = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }
        const connection = await db.getConnection();

        let { department_id, session_id, program_name, semester, sections, elective_subject_ids = [], is_active = 1, building_id } = req.body;
        if (req.departmentId) {
            department_id = req.departmentId;
        }

        const bldg_id = building_id || null;

        await connection.beginTransaction();

        // Duplicate checks
        const [existing] = await connection.query(
            'SELECT id FROM classes WHERE department_id = ? AND session_id = ? AND program_name = ? AND semester = ?', 
            [department_id, session_id, program_name, semester]
        );
        
        if (existing.length > 0) {
            await connection.rollback();
            return res.status(409).json({ success: false, message: 'This class already exists for the selected session.' });
        }

        // Insert Class
        const [result] = await connection.query(
            'INSERT INTO classes (department_id, session_id, program_name, semester, is_active, building_id) VALUES (?, ?, ?, ?, ?, ?)',
            [department_id, session_id, program_name, semester, is_active ? 1 : 0, bldg_id]
        );
        const classId = result.insertId;

        // Insert Sections
        if (sections && sections.length > 0) {
            for (let sec of sections) {
                await connection.query(
                    'INSERT INTO sections (class_id, section_name, student_strength, home_room_id, mode) VALUES (?, ?, ?, ?, ?)',
                    [classId, sec.section_name, sec.student_strength || 0, sec.home_room_id || null, sec.mode || 'Offline']
                );
            }
        } else {
            // Create default section 'A'
            await connection.query(
                'INSERT INTO sections (class_id, section_name, student_strength, home_room_id, mode) VALUES (?, ?, ?, ?, ?)',
                [classId, 'A', 0, null, 'Offline']
            );
        }

        // Insert Electives
        if (elective_subject_ids && elective_subject_ids.length > 0) {
            for (let subId of elective_subject_ids) {
                await connection.query(
                    'INSERT INTO class_electives (class_id, subject_id) VALUES (?, ?)',
                    [classId, subId]
                );
            }
        }

        await connection.commit();
        res.status(201).json({ success: true, message: 'Class and sections created', id: classId });
    } catch (error) {
        await connection.rollback();
        next(error);
    } finally {
        connection.release();
    }
};

// @route   PUT /api/classes/:id
export const updateClass = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }
        const connection = await db.getConnection();

        const { id } = req.params;
        let { department_id, session_id, program_name, semester, sections = [], elective_subject_ids = [], is_active = 1, building_id } = req.body;
        if (req.departmentId) {
            department_id = req.departmentId;
        }

        const bldg_id = building_id || null;

        await connection.beginTransaction();

        // Verify scope
        const [clsCheck] = await connection.query('SELECT department_id FROM classes WHERE id = ?', [id]);
        if (clsCheck.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Class not found' });
        }
        if (req.departmentId && clsCheck[0].department_id !== req.departmentId) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        // Duplicate checks
        const [existing] = await connection.query(
            'SELECT id FROM classes WHERE department_id = ? AND session_id = ? AND program_name = ? AND semester = ? AND id != ?', 
            [department_id, session_id, program_name, semester, id]
        );
        
        if (existing.length > 0) {
            await connection.rollback();
            return res.status(409).json({ success: false, message: 'This class already exists for the selected session.' });
        }

        // Update Class
        await connection.query(
            'UPDATE classes SET department_id = ?, session_id = ?, program_name = ?, semester = ?, is_active = ?, building_id = ? WHERE id = ?',
            [department_id, session_id, program_name, semester, is_active ? 1 : 0, bldg_id, id]
        );

        // Update Sections
        // Simple approach: delete existing sections (if not referenced) and re-insert. 
        // But if they have timetable/subject mappings, deleting will fail due to FK constraints.
        // Instead, we sync them. 
        const [existingSections] = await connection.query('SELECT id, section_name FROM sections WHERE class_id = ?', [id]);
        
        const newSectionNames = sections.map(s => s.section_name);
        
        for (let ex of existingSections) {
            if (!newSectionNames.includes(ex.section_name)) {
                // Delete if removed
                try {
                    await connection.query('DELETE FROM sections WHERE id = ?', [ex.id]);
                } catch (err) {
                    await connection.rollback();
                    return res.status(409).json({ success: false, message: `Cannot remove section ${ex.section_name} as it is currently in use.` });
                }
            }
        }

        for (let sec of sections) {
            const existingSec = existingSections.find(e => e.section_name === sec.section_name);
            if (existingSec) {
                await connection.query(
                    'UPDATE sections SET student_strength = ?, home_room_id = ?, mode = ? WHERE id = ?',
                    [sec.student_strength || 0, sec.home_room_id || null, sec.mode || 'Offline', existingSec.id]
                );
            } else {
                await connection.query(
                    'INSERT INTO sections (class_id, section_name, student_strength, home_room_id, mode) VALUES (?, ?, ?, ?, ?)',
                    [id, sec.section_name, sec.student_strength || 0, sec.home_room_id || null, sec.mode || 'Offline']
                );
            }
        }

        // Update Electives
        await connection.query('DELETE FROM class_electives WHERE class_id = ?', [id]);
        if (elective_subject_ids && elective_subject_ids.length > 0) {
            for (let subId of elective_subject_ids) {
                await connection.query(
                    'INSERT INTO class_electives (class_id, subject_id) VALUES (?, ?)',
                    [id, subId]
                );
            }
        }

        await connection.commit();
        res.json({ success: true, message: 'Class and sections updated' });
    } catch (error) {
        await connection.rollback();
        next(error);
    } finally {
        connection.release();
    }
};

// @route   DELETE /api/classes/:id
export const deleteClass = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        // Verify scope
        const [clsCheck] = await db.query('SELECT department_id FROM classes WHERE id = ?', [id]);
        if (clsCheck.length === 0) return res.status(404).json({ success: false, message: 'Class not found' });
        if (req.departmentId && clsCheck[0].department_id !== req.departmentId) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        const [result] = await db.query('DELETE FROM classes WHERE id = ?', [id]);
        
        if (result.affectedRows > 0) {
            res.json({ success: true, message: 'Class and its sections deleted successfully' });
        } else {
            res.status(404).json({ success: false, message: 'Class not found' });
        }
    } catch (error) {
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(409).json({ success: false, message: 'Cannot delete class as it is being referenced elsewhere' });
        }
        next(error);
    }
};

// @route   POST /api/classes/bulk-delete
export const bulkDeleteClasses = async (req, res, next) => {
    try {
        const { ids, department_ids } = req.body;
        
        if ((!Array.isArray(ids) || ids.length === 0) && (!Array.isArray(department_ids) || department_ids.length === 0)) {
            return res.status(400).json({ success: false, message: 'No classes or departments selected for deletion' });
        }
        
        let result;
        if (department_ids && department_ids.length > 0) {
            let deptIds = department_ids;
            if (req.departmentId) {
                if (!department_ids.includes(req.departmentId)) {
                     return res.status(403).json({ success: false, message: 'Forbidden' });
                }
                deptIds = [req.departmentId]; // Force to their own department
            }
            const placeholders = deptIds.map(() => '?').join(',');
            [result] = await db.query(`DELETE FROM classes WHERE department_id IN (${placeholders})`, deptIds);
        } else if (ids && ids.length > 0) {
            if (req.departmentId) {
                const placeholders = ids.map(() => '?').join(',');
                const [clsCheck] = await db.query(`SELECT COUNT(*) as cnt FROM classes WHERE id IN (${placeholders}) AND department_id != ?`, [...ids, req.departmentId]);
                if (clsCheck[0].cnt > 0) {
                    return res.status(403).json({ success: false, message: 'Forbidden: Some classes belong to another department' });
                }
            }
            const placeholders = ids.map(() => '?').join(',');
            [result] = await db.query(`DELETE FROM classes WHERE id IN (${placeholders})`, ids);
        }
        
        res.json({ success: true, message: `${result.affectedRows} classes deleted successfully` });
    } catch (error) {
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
             return res.status(409).json({ success: false, message: 'Some classes cannot be deleted because they are currently in use.' });
        }
        next(error);
    }
};

// @route   POST /api/classes/bulk-upload
export const bulkUploadClasses = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        let results = [];
        const errors = [];
        
        const connection = await db.getConnection();
        
        // Fetch mappings
        const [departments] = await connection.query('SELECT id, name, short_code FROM departments WHERE is_active = 1');
        const deptMap = {};
        departments.forEach(d => {
            deptMap[d.name.toLowerCase()] = d.id;
            deptMap[d.short_code.toLowerCase()] = d.id;
        });

        const [sessions] = await connection.query('SELECT id, name FROM academic_sessions');
        const sessionMap = {};
        sessions.forEach(s => {
            sessionMap[s.name.trim().toLowerCase()] = s.id;
        });

        const [buildings] = await connection.query('SELECT id, name FROM buildings');
        const buildingMap = {};
        buildings.forEach(b => {
            buildingMap[b.name.trim().toLowerCase()] = b.id;
        });

        // Fetch existing program names to enforce consistent casing (e.g., 'B.Tech cse' -> 'BTech CSE')
        const [existingPrograms] = await connection.query('SELECT DISTINCT program_name FROM classes');
        const normalizeProg = (p) => (p || '').replace(/\./g, '').replace(/\s+/g, ' ').trim().toUpperCase();
        const programMap = {};
        existingPrograms.forEach(p => {
            programMap[normalizeProg(p.program_name)] = p.program_name;
        });

        // Parse CSV/Excel
        try {
            const workbook = xlsx.readFile(req.file.path);
            const sheetName = workbook.SheetNames[0];
            results = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
        } catch (e) {
            connection.release();
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(400).json({ success: false, message: 'Failed to parse file. Please upload a valid CSV or Excel file.' });
        }

        let successCount = 0;
        let skippedCount = 0;

        // Normalize helper: lowercase + collapse multiple spaces
        const normalize = (str) => (str || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');

        // Rebuild sessionMap with normalized keys
        const sessionMapNorm = {};
        sessions.forEach(s => {
            sessionMapNorm[normalize(s.name)] = s.id;
        });

        for (let i = 0; i < results.length; i++) {
            const row = results[i];
            const rowIndex = i + 2;

            try {
                const rawProgramName = (row['Program Name'] || '').toString();
                // Strip dots, fix spaces, keep raw casing as fallback
                let cleanProgramName = rawProgramName.replace(/\./g, '').replace(/\s+/g, ' ').trim();
                
                // Map to existing consistent casing if a match is found
                const normProgKey = normalizeProg(cleanProgramName);
                if (programMap[normProgKey]) {
                    cleanProgramName = programMap[normProgKey];
                } else if (cleanProgramName) {
                    programMap[normProgKey] = cleanProgramName; // Save for subsequent rows in this batch
                }

                const programName = cleanProgramName;
                const dept        = (row['Department Code'] || '').toString().trim();
                const sessionName = (row['Session Name'] || '').toString().trim();
                const semesterStr = (row['Semester'] || '').toString().trim();
                const buildingRaw = (row['Building'] || '').toString().trim();
                const sectionRaw  = (row['Section Names'] || '').toString().trim();
                const strengthRaw = (row['Student Strengths'] || '').toString().trim();
                const modesRaw    = (row['Modes (Offline/Online)'] || row['Modes'] || '').toString().trim();

                const sectionNames = sectionRaw
                    ? sectionRaw.split(',').map(s => s.trim()).filter(Boolean)
                    : ['A'];
                const studentStrengthsArr = strengthRaw
                    ? strengthRaw.split(',').map(s => s.trim())
                    : [];
                const modesArr = modesRaw
                    ? modesRaw.split(',').map(s => {
                        const m = s.trim().toLowerCase();
                        return (m === 'online') ? 'Online' : 'Offline';
                    })
                    : [];

                if (!programName || !dept || !sessionName || !semesterStr) {
                    errors.push(`Row ${rowIndex}: Missing required fields (Program Name, Department Code, Session Name, Semester)`);
                    continue;
                }

                // Parse semester (numeric or Roman numeral)
                let semester = null;
                const romanMap = {
                    'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5,
                    'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10
                };
                if (romanMap[semesterStr.toUpperCase()]) {
                    semester = romanMap[semesterStr.toUpperCase()];
                } else {
                    semester = parseInt(semesterStr);
                }

                if (isNaN(semester) || semester < 1 || semester > 10) {
                    errors.push(`Row ${rowIndex}: Semester '${semesterStr}' must be 1–10 or Roman numeral I–X`);
                    continue;
                }

                // Department lookup (by short_code or name, normalized)
                let departmentId = req.departmentId || deptMap[dept.toLowerCase()];
                if (!departmentId) {
                    errors.push(`Row ${rowIndex}: Department '${dept}' not found. Available codes: ${departments.map(d => d.short_code).join(', ')}`);
                    continue;
                }

                // Session lookup with advanced fuzzy matching
                let sessionId = null;
                const cleanSessionInput = sessionName.replace(/[\s.\-]/g, '').toLowerCase();
                
                // 1. Try exact normalized match
                sessionId = sessionMapNorm[normalize(sessionName)];
                
                // 2. Try stripped exact match (e.g. julydecember == julydecember)
                if (!sessionId) {
                    const strippedMatch = sessions.find(s => s.name.replace(/[\s.\-]/g, '').toLowerCase() === cleanSessionInput);
                    if (strippedMatch) sessionId = strippedMatch.id;
                }
                
                // 3. Try partial substring match (e.g. 'julydec' in 'julydecember')
                if (!sessionId) {
                    const partialMatch = sessions.find(s => {
                        const cleanDbSession = s.name.replace(/[\s.\-]/g, '').toLowerCase();
                        return cleanDbSession.includes(cleanSessionInput) || cleanSessionInput.includes(cleanDbSession);
                    });
                    if (partialMatch) sessionId = partialMatch.id;
                }

                if (!sessionId) {
                    const available = sessions.map(s => s.name).join(', ');
                    errors.push(`Row ${rowIndex}: Session '${sessionName}' not found. Available: ${available}`);
                    continue;
                }

                let buildingId = null;
                if (buildingRaw) {
                    const cleanBldg = buildingRaw.trim().toLowerCase();
                    buildingId = buildingMap[cleanBldg];
                    if (!buildingId) {
                        errors.push(`Row ${rowIndex}: Building '${buildingRaw}' not found.`);
                        continue;
                    }
                }

                // Duplicate check
                const [existing] = await connection.query(
                    'SELECT id FROM classes WHERE department_id = ? AND session_id = ? AND program_name = ? AND semester = ?',
                    [departmentId, sessionId, programName, semester]
                );
                if (existing.length > 0) {
                    skippedCount++;
                    continue; // silently skip duplicates (not counted as error)
                }

                await connection.beginTransaction();

                const [result] = await connection.query(
                    'INSERT INTO classes (department_id, session_id, program_name, semester, building_id) VALUES (?, ?, ?, ?, ?)',
                    [departmentId, sessionId, programName, semester, buildingId]
                );
                const classId = result.insertId;

                for (let sIdx = 0; sIdx < sectionNames.length; sIdx++) {
                    const strength = studentStrengthsArr[sIdx] ? parseInt(studentStrengthsArr[sIdx]) : 0;
                    const mode = modesArr[sIdx] || 'Offline';
                    await connection.query(
                        'INSERT INTO sections (class_id, section_name, student_strength, home_room_id, mode) VALUES (?, ?, ?, ?, ?)',
                        [classId, sectionNames[sIdx], isNaN(strength) ? 0 : strength, null, mode]
                    );
                }

                await connection.commit();
                successCount++;
            } catch (err) {
                try { await connection.rollback(); } catch (_) {}
                const dbMsg = err?.sqlMessage || err?.message || 'Unknown error';
                errors.push(`Row ${rowIndex}: ${dbMsg}`);
            }
        }


        connection.release();
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            summary: { total: results.length, inserted: successCount, skipped: skippedCount, errors: errors.length },
            message: `Bulk upload complete. Added ${successCount} classes.`,
            errors: errors.length > 0 ? errors : null
        });

    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        next(error);
    }
};

// @route   GET /api/classes/sections-suggestions
// Fetch sections with their strength, and all rooms for a department to facilitate smart room allocation
export const getAllSectionsWithRooms = async (req, res, next) => {
    try {
        let { department_id, session_id, building_id } = req.query;
        if (req.departmentId) department_id = req.departmentId;

        if (!session_id) {
            return res.status(400).json({ success: false, message: 'Session ID is required.' });
        }
        
        let secWhere = 'c.session_id = ? AND c.is_active = 1';
        const secParams = [session_id];
        
        let roomWhere = 'r.is_active = 1';
        const roomParams = [];
        
        let subWhere = 's.is_active = 1 AND s.subject_type IN ("lab", "both")';
        const subParams = [];

        if (department_id && department_id !== 'all') {
            secWhere += ' AND c.department_id = ?';
            secParams.push(department_id);
            
            subWhere += ' AND s.department_id = ?';
            subParams.push(department_id);
        }

        if (building_id && building_id !== 'all') {
            secWhere += ' AND COALESCE(c.building_id, d.building_id) = ?';
            secParams.push(building_id);
            
            // SubWhere: we don't have building_id on subjects. For subjects, we might still want to fetch subjects for departments that have rooms in this building, OR just don't filter subjects by building strictly (if dept is selected, it's filtered above).
            // Actually, we can fetch subjects of the departments that correspond to these sections.
            // A simpler way: we just let building_id filter the sections, and for subjects, we leave it alone unless department is selected.
            
            roomWhere += ' AND (r.building_id = ? OR r.department_id IS NULL OR r.department_id = 0 OR r.department_id = "")';
            roomParams.push(building_id);
        } else if (department_id && department_id !== 'all') {
            // Find buildings where this department has rooms
            const [bldgRows] = await db.query('SELECT DISTINCT building_id FROM rooms WHERE department_id = ?', [department_id]);
            const bldgIds = bldgRows.map(r => r.building_id).filter(id => id);
            
            // ALSO find buildings that are overridden for this department's classes
            const [overrideRows] = await db.query('SELECT DISTINCT building_id FROM classes WHERE department_id = ? AND session_id = ? AND is_active = 1 AND building_id IS NOT NULL', [department_id, session_id]);
            overrideRows.forEach(r => {
                if (!bldgIds.includes(r.building_id)) {
                    bldgIds.push(r.building_id);
                }
            });
            
            if (bldgIds.length > 0) {
                const placeholders = bldgIds.map(() => '?').join(',');
                roomWhere += ` AND (r.department_id = ? OR r.department_id IS NULL OR r.department_id = 0 OR r.department_id = "" OR r.building_id IN (${placeholders}))`;
                roomParams.push(department_id, ...bldgIds);
            } else {
                roomWhere += ' AND (r.department_id = ? OR r.department_id IS NULL OR r.department_id = 0 OR r.department_id = "")';
                roomParams.push(department_id);
            }
        }

        // Fetch sections
        const [sections] = await db.query(`
            SELECT sec.id, sec.class_id, sec.section_name, sec.student_strength, sec.home_room_id, sec.mode, sec.merge_group_id,
                   c.program_name, c.semester, c.department_id, c.building_id,
                   hr.room_number as home_room_number,
                   d.short_code as dept_short_code,
                   d.building_id as dept_building_id,
                   COALESCE(c.building_id, d.building_id) as class_building_id
            FROM sections sec
            JOIN classes c ON sec.class_id = c.id
            LEFT JOIN rooms hr ON sec.home_room_id = hr.id
            LEFT JOIN departments d ON c.department_id = d.id
            WHERE ${secWhere}
            ORDER BY c.department_id ASC, c.semester ASC, c.program_name ASC, sec.section_name ASC
        `, secParams);

        // Fetch rooms
        const [rooms] = await db.query(`
            SELECT r.id, r.room_number, r.capacity, r.room_type, r.department_id, d.name as department_name, d.short_code as department_short_code, b.name as building_name, r.building_id, r.is_smart_room,
                   (SELECT COUNT(DISTINCT IFNULL(sec.merge_group_id, sec.id)) FROM sections sec JOIN classes c ON sec.class_id = c.id JOIN academic_sessions sess ON c.session_id = sess.id WHERE sec.home_room_id = r.id AND sess.is_active = 1) as theory_allocation_count,
                   (SELECT COUNT(DISTINCT IFNULL(sec.merge_group_id, sec.id)) FROM section_subjects ss JOIN sections sec ON ss.section_id = sec.id JOIN classes c ON sec.class_id = c.id JOIN academic_sessions sess ON c.session_id = sess.id WHERE ss.room_id = r.id AND sess.is_active = 1) as lab_allocation_count,
                   (SELECT GROUP_CONCAT(DISTINCT CONCAT(c.semester, ' ', c.program_name, IF(sec.section_name != '', CONCAT(' ', sec.section_name), '')) SEPARATOR ', ') FROM sections sec JOIN classes c ON sec.class_id = c.id JOIN academic_sessions sess ON c.session_id = sess.id WHERE sec.home_room_id = r.id AND sess.is_active = 1) as theory_allocated_classes
            FROM rooms r
            LEFT JOIN buildings b ON r.building_id = b.id
            LEFT JOIN departments d ON r.department_id = d.id
            WHERE ${roomWhere}
            ORDER BY r.capacity ASC
        `, roomParams);

        // Fetch lab subjects
        const [labSubjects] = await db.query(`
            SELECT s.id, s.full_name, s.short_code, s.program_name, s.semester, ss.section_id, ss.room_id as saved_room_id
            FROM subjects s
            LEFT JOIN section_subjects ss ON s.id = ss.subject_id
            WHERE ${subWhere}
        `, subParams);

        res.json({
            success: true,
            data: {
                sections,
                rooms,
                labSubjects
            }
        });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/classes/save-room-allocations
// Save bulk theory and lab room allocations
export const saveRoomAllocations = async (req, res, next) => {
    const conn = await db.getConnection();
    try {
        const { theoryAllocations, labAllocations } = req.body;
        
        await conn.beginTransaction();

        // 1. Save Theory Allocations (Update sections.home_room_id)
        if (theoryAllocations && theoryAllocations.length > 0) {
            for (const alloc of theoryAllocations) {
                // alloc = { section_id: 1, room_id: 5 }
                if (alloc.room_id) {
                    await conn.query('UPDATE sections SET home_room_id = ? WHERE id = ?', [alloc.room_id, alloc.section_id]);
                } else {
                    await conn.query('UPDATE sections SET home_room_id = NULL WHERE id = ?', [alloc.section_id]);
                }
            }
        }

        // 2. Save Lab Allocations (Update section_subjects.room_id)
        if (labAllocations && labAllocations.length > 0) {
            for (const alloc of labAllocations) {
                // alloc = { section_id: 1, subject_id: 2, room_id: 6 }
                if (alloc.room_id) {
                    await conn.query(`
                        INSERT INTO section_subjects (section_id, subject_id, allocation_type, room_id, teacher_id) 
                        VALUES (?, ?, 'lab', ?, NULL)
                        ON DUPLICATE KEY UPDATE room_id = VALUES(room_id)
                    `, [alloc.section_id, alloc.subject_id, alloc.room_id]);
                } else {
                    await conn.query(`
                        UPDATE section_subjects 
                        SET room_id = NULL 
                        WHERE section_id = ? AND subject_id = ? AND allocation_type = 'lab'
                    `, [alloc.section_id, alloc.subject_id]);
                }
            }
        }

        await conn.commit();
        res.json({ success: true, message: 'Room allocations saved successfully!' });
    } catch (error) {
        await conn.rollback();
        next(error);
    } finally {
        conn.release();
    }
};

// @route   PUT /api/classes/sections/:id/strength
export const updateSectionStrength = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { student_strength } = req.body;
        
        if (student_strength === undefined || student_strength < 0) {
            return res.status(400).json({ success: false, message: 'Invalid student strength.' });
        }

        // Add a department check to ensure the user is authorized to edit this section
        if (req.departmentId) {
            const [rows] = await db.query(`
                SELECT c.department_id FROM sections sec
                JOIN classes c ON sec.class_id = c.id
                WHERE sec.id = ?
            `, [id]);
            if (rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Section not found' });
            }
            if (rows[0].department_id !== req.departmentId) {
                return res.status(403).json({ success: false, message: 'Not authorized for this department' });
            }
        }

        await db.query('UPDATE sections SET student_strength = ? WHERE id = ?', [student_strength, id]);

        res.json({ success: true, message: 'Section strength updated successfully!' });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/classes/merge-sections
export const mergeSections = async (req, res, next) => {
    try {
        const { section_ids } = req.body;
        if (!section_ids || !Array.isArray(section_ids) || section_ids.length < 2) {
            return res.status(400).json({ success: false, message: 'Please select at least 2 sections to merge.' });
        }

        if (req.departmentId) {
            const placeholders = section_ids.map(() => '?').join(',');
            const [rows] = await db.query(`
                SELECT DISTINCT c.department_id FROM sections sec
                JOIN classes c ON sec.class_id = c.id
                WHERE sec.id IN (${placeholders})
            `, section_ids);
            
            if (rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Sections not found' });
            }
            if (rows.some(r => r.department_id !== req.departmentId)) {
                return res.status(403).json({ success: false, message: 'Not authorized to merge these sections' });
            }
        }

        const mergeGroupId = Math.floor(100000 + Math.random() * 900000).toString();
        const placeholders = section_ids.map(() => '?').join(',');
        await db.query(`UPDATE sections SET merge_group_id = ? WHERE id IN (${placeholders})`, [mergeGroupId, ...section_ids]);

        res.json({ success: true, message: 'Sections merged successfully.' });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/classes/unmerge-sections
export const unmergeSections = async (req, res, next) => {
    try {
        const { section_ids } = req.body;
        if (!section_ids || !Array.isArray(section_ids) || section_ids.length === 0) {
            return res.status(400).json({ success: false, message: 'Please select sections to unmerge.' });
        }

        if (req.departmentId) {
            const placeholders = section_ids.map(() => '?').join(',');
            const [rows] = await db.query(`
                SELECT DISTINCT c.department_id FROM sections sec
                JOIN classes c ON sec.class_id = c.id
                WHERE sec.id IN (${placeholders})
            `, section_ids);
            
            if (rows.some(r => r.department_id !== req.departmentId)) {
                return res.status(403).json({ success: false, message: 'Not authorized to unmerge these sections' });
            }
        }

        const placeholders = section_ids.map(() => '?').join(',');
        await db.query(`UPDATE sections SET merge_group_id = NULL WHERE id IN (${placeholders})`, section_ids);

        res.json({ success: true, message: 'Sections unmerged successfully.' });
    } catch (error) {
        next(error);
    }
};
