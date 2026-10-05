import db from '../config/db.js';
import { validationResult } from 'express-validator';
import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';

// @route   GET /api/teachers
export const getTeachers = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        let department_id = req.query.department_id;
        if (req.departmentId) {
            department_id = req.departmentId;
        }
        const offset = (page - 1) * limit;

        let query = `
            SELECT t.*, d.name as department_name, d.short_code as department_code 
            FROM teachers t
            LEFT JOIN departments d ON t.department_id = d.id
        `;
        let countQuery = 'SELECT COUNT(*) as total FROM teachers t';
        const params = [];
        const whereConditions = [];

        if (search) {
            whereConditions.push('(t.full_name LIKE ? OR t.short_name LIKE ? OR t.employee_code LIKE ?)');
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        
        const exclude_secondary = req.query.exclude_secondary === 'true';

        if (department_id) {
            if (exclude_secondary) {
                whereConditions.push('t.department_id = ?');
                params.push(department_id);
            } else {
                whereConditions.push('(t.department_id = ? OR (t.secondary_departments IS NOT NULL AND t.secondary_departments != "" AND (JSON_CONTAINS(t.secondary_departments, ?) OR JSON_CONTAINS(t.secondary_departments, ?))))');
                params.push(department_id, `"${department_id}"`, department_id.toString());
            }
        }

        if (req.query.is_free === 'true') {
            whereConditions.push('t.is_active = 1');
            whereConditions.push('t.id NOT IN (SELECT DISTINCT teacher_id FROM section_subjects WHERE teacher_id IS NOT NULL)');
        }

        if (whereConditions.length > 0) {
            const whereClause = ' WHERE ' + whereConditions.join(' AND ');
            query += whereClause;
            countQuery += whereClause;
        }

        query += ' ORDER BY t.full_name ASC LIMIT ? OFFSET ?';
        
        const [countResult] = await db.query(countQuery, params);
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

// @route   GET /api/teachers/stats
export const getTeacherStats = async (req, res, next) => {
    try {
        let department_id = req.query.department_id;
        if (req.departmentId) {
            department_id = req.departmentId;
        }

        // 1. Total University Teachers
        const [uniResult] = await db.query('SELECT COUNT(*) as count FROM teachers');
        const total_university = uniResult[0].count;

        let primary_count = 0;
        let secondary_count = 0;
        let active_count = 0;
        let inactive_count = 0;
        let free_count = 0;

        if (department_id) {
            const [prim] = await db.query('SELECT COUNT(*) as count FROM teachers WHERE department_id = ?', [department_id]);
            primary_count = prim[0].count;

            const [sec] = await db.query('SELECT COUNT(*) as count FROM teachers WHERE secondary_departments IS NOT NULL AND secondary_departments != "" AND (JSON_CONTAINS(secondary_departments, ?) OR JSON_CONTAINS(secondary_departments, ?)) AND department_id != ?', [department_id.toString(), `"${department_id}"`, department_id]);
            secondary_count = sec[0].count;

            const [act] = await db.query('SELECT COUNT(*) as count FROM teachers WHERE department_id = ? AND is_active = 1', [department_id]);
            active_count = act[0].count;

            const [inact] = await db.query('SELECT COUNT(*) as count FROM teachers WHERE department_id = ? AND is_active = 0', [department_id]);
            inactive_count = inact[0].count;
            
            const [free] = await db.query('SELECT COUNT(*) as count FROM teachers WHERE department_id = ? AND is_active = 1 AND id NOT IN (SELECT DISTINCT teacher_id FROM section_subjects WHERE teacher_id IS NOT NULL)', [department_id]);
            free_count = free[0].count;
        } else {
            primary_count = total_university; // All teachers have a primary dept
            const [sec] = await db.query('SELECT COUNT(*) as count FROM teachers WHERE secondary_departments IS NOT NULL AND secondary_departments != "[]" AND secondary_departments != ""');
            secondary_count = sec[0].count; // Teachers that have at least one secondary dept

            const [act] = await db.query('SELECT COUNT(*) as count FROM teachers WHERE is_active = 1');
            active_count = act[0].count;

            const [inact] = await db.query('SELECT COUNT(*) as count FROM teachers WHERE is_active = 0');
            inactive_count = inact[0].count;
            
            const [free] = await db.query('SELECT COUNT(*) as count FROM teachers WHERE is_active = 1 AND id NOT IN (SELECT DISTINCT teacher_id FROM section_subjects WHERE teacher_id IS NOT NULL)');
            free_count = free[0].count;
        }

        res.json({
            success: true,
            data: {
                total_university,
                primary_count,
                secondary_count,
                active_count,
                inactive_count,
                free_count
            }
        });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/teachers
export const createTeacher = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { department_id, full_name, short_name, designation, expertise, email, mobile, employee_code, is_active, secondary_departments } = req.body;
        const active = is_active !== undefined ? is_active : 1;
        const final_department_id = req.departmentId || department_id;
        
        // Photo handling
        let photoPath = null;
        if (req.file) {
            photoPath = `/uploads/teachers/${req.file.filename}`;
        }

        // Duplicate checks
        const [existingCode] = await db.query('SELECT id FROM teachers WHERE employee_code = ? AND employee_code IS NOT NULL AND employee_code != ""', [employee_code]);
        if (existingCode.length > 0) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(409).json({ success: false, message: 'Employee code already exists' });
        }

        const [existingShort] = await db.query('SELECT id FROM teachers WHERE department_id = ? AND short_name = ?', [final_department_id, short_name]);
        if (existingShort.length > 0) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(409).json({ success: false, message: 'Short name already exists in this department' });
        }

        // Insert
        // Note: max_daily_load and max_weekly_load have default values (6, 24) in the DB
        const secondaryDeptsJson = secondary_departments ? (typeof secondary_departments === 'string' ? secondary_departments : JSON.stringify(secondary_departments)) : null;
        
        const [result] = await db.query(
            `INSERT INTO teachers (
                department_id, full_name, short_name, designation, expertise, 
                email, mobile, employee_code, photo, is_active, secondary_departments
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [final_department_id, full_name, short_name, designation, expertise || null, email, mobile, employee_code, photoPath, active, secondaryDeptsJson]
        );

        res.status(201).json({ success: true, message: 'Teacher created', id: result.insertId });
    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        next(error);
    }
};

// @route   PUT /api/teachers/:id
export const updateTeacher = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { id } = req.params;
        const { department_id, full_name, short_name, designation, expertise, email, mobile, employee_code, is_active, secondary_departments } = req.body;
        const active = is_active !== undefined ? is_active : 1;
        const final_department_id = req.departmentId || department_id;

        // Get existing record to manage old photo
        const [existingTeacher] = await db.query('SELECT photo FROM teachers WHERE id = ?', [id]);
        if (existingTeacher.length === 0) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(404).json({ success: false, message: 'Teacher not found' });
        }

        let photoPath = existingTeacher[0].photo;
        if (req.file) {
            photoPath = `/uploads/teachers/${req.file.filename}`;
            // Delete old photo
            if (existingTeacher[0].photo) {
                const oldPath = path.join(process.cwd(), 'public', existingTeacher[0].photo);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
        }

        // Duplicate checks
        const [existingCode] = await db.query('SELECT id FROM teachers WHERE employee_code = ? AND id != ? AND employee_code IS NOT NULL AND employee_code != ""', [employee_code, id]);
        if (existingCode.length > 0) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(409).json({ success: false, message: 'Employee code already exists' });
        }

        const [existingShort] = await db.query('SELECT id FROM teachers WHERE department_id = ? AND short_name = ? AND id != ?', [final_department_id, short_name, id]);
        if (existingShort.length > 0) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(409).json({ success: false, message: 'Short name already exists in this department' });
        }

        const secondaryDeptsJson = secondary_departments ? (typeof secondary_departments === 'string' ? secondary_departments : JSON.stringify(secondary_departments)) : null;
        
        await db.query(
            `UPDATE teachers SET 
                department_id = ?, full_name = ?, short_name = ?, designation = ?, expertise = ?, 
                email = ?, mobile = ?, employee_code = ?, photo = ?, is_active = ?, secondary_departments = ? 
            WHERE id = ?`,
            [final_department_id, full_name, short_name, designation, expertise || null, email, mobile, employee_code, photoPath, active, secondaryDeptsJson, id]
        );

        res.json({ success: true, message: 'Teacher updated' });
    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        next(error);
    }
};

// @route   DELETE /api/teachers/:id
export const deleteTeacher = async (req, res, next) => {
    const connection = await db.getConnection();
    try {
        const { id } = req.params;

        const [teacher] = await connection.query('SELECT photo, full_name FROM teachers WHERE id = ?', [id]);
        if (teacher.length === 0) {
            connection.release();
            return res.status(404).json({ success: false, message: 'Teacher not found' });
        }

        await connection.beginTransaction();

        // Delete in FK-safe order (children first, parent last)

        // 1. Remove substitute references in replacement records first
        await connection.query('DELETE FROM timetable_replacements WHERE substitute_teacher_id = ?', [id]);

        // 2. Delete timetable entries assigned to this teacher
        await connection.query('DELETE FROM timetable WHERE teacher_id = ?', [id]);

        // 3. Delete section_subjects allocations (theory & lab) for this teacher
        await connection.query('DELETE FROM section_subjects WHERE teacher_id = ?', [id]);

        // 4. Delete subject_teacher mappings
        await connection.query('DELETE FROM subject_teacher WHERE teacher_id = ?', [id]);

        // 5. Delete leave records — their replacement refs are already cleared above
        await connection.query('DELETE FROM teacher_leaves WHERE teacher_id = ?', [id]);

        // 6. Delete teacher availability records
        try { await connection.query('DELETE FROM teacher_availability WHERE teacher_id = ?', [id]); } catch (_) {}

        // 7. Unlink users account (NULL the teacher_id rather than deleting the user)
        await connection.query('UPDATE users SET teacher_id = NULL WHERE teacher_id = ?', [id]);

        // 8. Finally delete the teacher
        await connection.query('DELETE FROM teachers WHERE id = ?', [id]);

        await connection.commit();

        // Delete photo file if exists
        if (teacher[0].photo) {
            try {
                const oldPath = path.join(process.cwd(), 'public', teacher[0].photo);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            } catch (_) {}
        }

        res.json({ success: true, message: `Teacher "${teacher[0].full_name}" and all related records deleted successfully.` });
    } catch (error) {
        try { await connection.rollback(); } catch (_) {}
        next(error);
    } finally {
        connection.release();
    }
};



// @route   POST /api/teachers/bulk
export const bulkUploadTeachers = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        let results = [];
        const errors = [];
        
        // Fetch all departments to map IDs
        const [departments] = await db.query('SELECT id, name, short_code FROM departments');
        const deptMap = {};
        departments.forEach(d => {
            deptMap[d.name.toLowerCase()] = d.id;
            deptMap[d.short_code.toLowerCase()] = d.id;
        });

        try {
            const workbook = xlsx.readFile(req.file.path);
            const sheetName = workbook.SheetNames[0];
            results = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
        } catch (e) {
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(400).json({ success: false, message: 'Failed to parse file. Please upload a valid CSV or Excel file.' });
        }
        
        let successCount = 0;
        // Track short names used in this batch to avoid intra-batch duplicates
        const usedShortNames = new Set(); 

        for (let i = 0; i < results.length; i++) {
            const row = results[i];
            const rowIndex = i + 2;
            
            try {
                const name = (row['Name'] || '').toString().trim();
                const empId = (row['Employee ID'] || '').toString().trim() || null;
                const dept = (row['Department'] || '').toString().trim();
                const designation = (row['Designation'] || '').toString().trim();
                const expertise = (row['Expertise'] || '').toString().trim() || null;
                const mobile = (row['Mobile'] || '').toString().trim() || null;
                const shortNameRaw = (row['Short Name'] || '').toString().trim() || null;

                if (!name || !dept) {
                    errors.push(`Row ${rowIndex}: Missing required fields (Name, Department)`);
                    continue;
                }
                
                const finalDesignation = designation || 'Faculty';

                const department_id = deptMap[dept.toLowerCase()];
                if (!department_id) {
                    errors.push(`Row ${rowIndex}: Department '${dept}' not found in the system`);
                    continue;
                }

                // Duplicate check for Employee ID (if provided)
                if (empId) {
                    const [existing] = await db.query('SELECT id FROM teachers WHERE employee_code = ? AND employee_code IS NOT NULL AND employee_code != ""', [empId]);
                    if (existing.length > 0) {
                        errors.push(`Row ${rowIndex}: Employee ID '${empId}' already exists — skipped`);
                        continue;
                    }
                }

                // Resolve short name — auto-suffix if collision
                let finalShortName = shortNameRaw;
                if (!finalShortName) {
                    // Auto-generate from initials
                    finalShortName = name.split(' ').map(n => n.charAt(0).toUpperCase()).join('').substring(0, 20);
                }

                // Ensure uniqueness in DB + in this batch
                let candidate = finalShortName.substring(0, 18);
                let counter = 1;
                while (true) {
                    const key = `${department_id}_${candidate}`;
                    if (usedShortNames.has(key)) {
                        candidate = `${finalShortName.substring(0, 17)}${counter}`;
                        counter++;
                        continue;
                    }
                    const [existingShort] = await db.query('SELECT id FROM teachers WHERE department_id = ? AND short_name = ?', [department_id, candidate]);
                    if (existingShort.length === 0) {
                        finalShortName = candidate;
                        usedShortNames.add(key);
                        break;
                    }
                    candidate = `${finalShortName.substring(0, 17)}${counter}`;
                    counter++;
                    if (counter > 99) {
                        errors.push(`Row ${rowIndex}: Could not generate a unique short name for '${name}'`);
                        finalShortName = null;
                        break;
                    }
                }
                if (!finalShortName) continue;

                await db.query(
                    `INSERT INTO teachers (
                        department_id, full_name, short_name, designation, expertise, 
                        mobile, employee_code, is_active
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [department_id, name, finalShortName, finalDesignation, expertise, mobile, empId, 1]
                );
                
                successCount++;
            } catch (err) {
                // Show the real DB error message to help diagnose
                const dbMsg = err?.sqlMessage || err?.message || 'Unknown error';
                errors.push(`Row ${rowIndex}: ${dbMsg}`);
            }
        }


        // Delete file after processing
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            message: `Bulk upload complete. Successfully added ${successCount} teachers.`,
            errors: errors.length > 0 ? errors : null
        });

    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        next(error);
    }
};

// @route   DELETE /api/teachers/bulk-by-department
// Delete all teachers from one or more departments
export const deleteTeachersByDepartment = async (req, res, next) => {
    const connection = await db.getConnection();
    try {
        const { department_ids } = req.body; // array of department IDs

        if (!department_ids || !Array.isArray(department_ids) || department_ids.length === 0) {
            connection.release();
            return res.status(400).json({ success: false, message: 'At least one department must be selected.' });
        }

        // Fetch all teacher IDs in those departments
        const [teacherRows] = await connection.query(
            'SELECT id, photo FROM teachers WHERE department_id IN (?)',
            [department_ids]
        );

        if (teacherRows.length === 0) {
            connection.release();
            return res.json({ success: true, message: 'No teachers found in the selected departments.', deleted: 0 });
        }

        const teacherIds = teacherRows.map(t => t.id);

        await connection.beginTransaction();

        // Delete in FK-safe order
        await connection.query('DELETE FROM timetable_replacements WHERE substitute_teacher_id IN (?)', [teacherIds]);
        await connection.query('DELETE FROM timetable WHERE teacher_id IN (?)', [teacherIds]);
        await connection.query('DELETE FROM section_subjects WHERE teacher_id IN (?)', [teacherIds]);
        await connection.query('DELETE FROM subject_teacher WHERE teacher_id IN (?)', [teacherIds]);
        await connection.query('DELETE FROM teacher_leaves WHERE teacher_id IN (?)', [teacherIds]);
        try { await connection.query('DELETE FROM teacher_availability WHERE teacher_id IN (?)', [teacherIds]); } catch (_) {}
        try { await connection.query('DELETE FROM teacher_preferences WHERE teacher_id IN (?)', [teacherIds]); } catch (_) {}
        await connection.query('UPDATE users SET teacher_id = NULL WHERE teacher_id IN (?)', [teacherIds]);
        await connection.query('DELETE FROM teachers WHERE id IN (?)', [teacherIds]);

        await connection.commit();

        // Delete photo files
        teacherRows.forEach(t => {
            if (t.photo) {
                try {
                    const oldPath = path.join(process.cwd(), 'public', t.photo);
                    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
                } catch (_) {}
            }
        });

        res.json({ success: true, message: `Successfully deleted ${teacherIds.length} teacher(s).`, deleted: teacherIds.length });
    } catch (error) {
        try { await connection.rollback(); } catch (_) {}
        next(error);
    } finally {
        connection.release();
    }
};

// @route   GET /api/teachers/verify/:code
export const verifyTeacher = async (req, res, next) => {
    try {
        const code = (req.params.code || '').toString().trim();
        const cleanCode = code.replace(/\s+/g, '').toLowerCase();
        
        const [teacher] = await db.query(`
            SELECT t.id, t.full_name, t.employee_code, t.email, t.mobile, t.department_id, d.name as department_name 
            FROM teachers t 
            LEFT JOIN departments d ON t.department_id = d.id 
            WHERE LOWER(REPLACE(t.employee_code, ' ', '')) = ?
               OR LOWER(REPLACE(t.employee_code, ' ', '')) = CONCAT('e', ?)
               OR LOWER(t.employee_code) LIKE CONCAT('%', ?, '%')
            LIMIT 1
        `, [cleanCode, cleanCode, cleanCode]);
        
        if (teacher.length > 0) {
            res.json({ success: true, data: teacher[0] });
        } else {
            res.status(404).json({ success: false, message: `Teacher not found with Employee ID: ${code}` });
        }
    } catch (error) {
        next(error);
    }
};
