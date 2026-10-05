import db from '../config/db.js';
import { validationResult } from 'express-validator';
import fs from 'fs';
import xlsx from 'xlsx';

// @route   GET /api/subjects
export const getSubjects = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        let department_id = req.query.department_id;
        if (req.departmentId) {
            department_id = req.departmentId;
        }
        const program_name = req.query.program_name;
        const semester = req.query.semester;
        const offset = (page - 1) * limit;

        let query = `
            SELECT s.*, d.name as department_name, d.short_code as department_code,
                   (SELECT GROUP_CONCAT(section_id) FROM subject_section_mapping WHERE subject_id = s.id) as section_ids
            FROM subjects s
            LEFT JOIN departments d ON s.department_id = d.id
        `;
        let countQuery = 'SELECT COUNT(*) as total FROM subjects s';
        const params = [];
        const whereConditions = [];

        if (search) {
            whereConditions.push('(s.full_name LIKE ? OR s.short_code LIKE ? OR s.program_name LIKE ? OR CAST(s.semester AS CHAR) LIKE ?)');
            params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
        }
        
        if (department_id) {
            whereConditions.push('s.department_id = ?');
            params.push(department_id);
        }

        if (program_name) {
            whereConditions.push(`(
                s.program_name = ? 
                OR EXISTS (
                    SELECT 1 FROM classes c 
                    JOIN sections sec ON sec.class_id = c.id 
                    WHERE c.program_name = ? AND s.program_name = CONCAT(c.program_name, ' ', sec.section_name)
                )
                OR EXISTS (
                    SELECT 1 FROM subject_section_mapping ssm 
                    JOIN sections sec ON ssm.section_id = sec.id 
                    JOIN classes c ON sec.class_id = c.id 
                    WHERE ssm.subject_id = s.id AND c.program_name = ?
                )
            )`);
            params.push(program_name, program_name, program_name);
        }

        if (semester) {
            whereConditions.push(`(
                s.semester = ? 
                OR EXISTS (
                    SELECT 1 FROM subject_section_mapping ssm 
                    JOIN sections sec ON ssm.section_id = sec.id 
                    JOIN classes c ON sec.class_id = c.id 
                    WHERE ssm.subject_id = s.id AND c.semester = ?
                )
            )`);
            params.push(semester, semester);
        }

        if (req.query.is_elective !== undefined) {
            whereConditions.push('s.is_elective = ?');
            params.push(req.query.is_elective);
        }

        if (req.query.is_nptel !== undefined) {
            whereConditions.push('s.is_nptel = ?');
            params.push(req.query.is_nptel);
        }

        if (req.query.allocation_status) {
            let sessionJoin = '';
            let sessionCondition = '';
            if (req.query.session_id) {
                sessionJoin = ' JOIN sections sec ON ss.section_id = sec.id JOIN classes c ON sec.class_id = c.id';
                sessionCondition = ' AND c.session_id = ?';
            }
            if (req.query.allocation_status === 'allocated') {
                whereConditions.push(`EXISTS (SELECT 1 FROM section_subjects ss ${sessionJoin} WHERE ss.subject_id = s.id ${sessionCondition})`);
                if (req.query.session_id) params.push(req.query.session_id);
            } else if (req.query.allocation_status === 'unallocated') {
                whereConditions.push(`NOT EXISTS (SELECT 1 FROM section_subjects ss ${sessionJoin} WHERE ss.subject_id = s.id ${sessionCondition})`);
                if (req.query.session_id) params.push(req.query.session_id);
            }
        }

        if (req.query.is_active_for_session === '1') {
            const sessionId = req.query.session_id ? parseInt(req.query.session_id) : null;
            const sessionFilter = sessionId ? ` AND c.session_id = ${sessionId}` : '';
            whereConditions.push(`s.is_active = 1 AND (s.is_elective = 0 OR EXISTS (
                SELECT 1 FROM class_electives ce 
                JOIN classes c ON ce.class_id = c.id 
                WHERE ce.subject_id = s.id AND c.is_active = 1${sessionFilter}
            ))`);
        }

        if (req.query.subject_type) {
            whereConditions.push('s.subject_type = ?');
            params.push(req.query.subject_type);
        }

        if (req.query.semester_type) {
            if (req.query.semester_type === 'odd') {
                whereConditions.push('(s.semester % 2 != 0 OR s.semester IS NULL)');
            } else if (req.query.semester_type === 'even') {
                whereConditions.push('(s.semester % 2 = 0 OR s.semester IS NULL)');
            }
        }

        if (whereConditions.length > 0) {
            const whereClause = ' WHERE ' + whereConditions.join(' AND ');
            query += whereClause;
            countQuery += whereClause;
        }

        query += ' ORDER BY s.full_name ASC LIMIT ? OFFSET ?';
        
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
                totalPages: Math.ceil(totalRows / limit),
                pages: Math.ceil(totalRows / limit)
            }
        });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/subjects/stats
export const getSubjectStats = async (req, res, next) => {
    try {
        const dept_id = req.departmentId || req.query.department_id || null;
        const sessionId = req.query.session_id ? parseInt(req.query.session_id) : null;
        const sessionFilter = sessionId ? ` AND c.session_id = ${sessionId}` : '';

        let whereClause = `WHERE s.is_active = 1 AND (s.is_elective = 0 OR EXISTS (
            SELECT 1 FROM class_electives ce 
            JOIN classes c ON ce.class_id = c.id 
            WHERE ce.subject_id = s.id AND c.is_active = 1${sessionFilter}
        ))`;

        if (req.query.semester_type === 'odd') {
            whereClause += ' AND (s.semester % 2 != 0 OR s.semester IS NULL)';
        } else if (req.query.semester_type === 'even') {
            whereClause += ' AND (s.semester % 2 = 0 OR s.semester IS NULL)';
        }
        const params = [];
        if (dept_id) {
            whereClause += ' AND s.department_id = ?';
            params.push(dept_id);
        }

        let allocatedCondition = 'SELECT 1 FROM section_subjects ss WHERE ss.subject_id = s.id LIMIT 1';
        if (req.query.session_id) {
            allocatedCondition = `
                SELECT 1 FROM section_subjects ss 
                JOIN sections sec ON ss.section_id = sec.id 
                JOIN classes c ON sec.class_id = c.id 
                WHERE ss.subject_id = s.id AND c.session_id = ? LIMIT 1
            `;
            // Add session_id twice: once for allocated, once for unallocated
            params.push(req.query.session_id, req.query.session_id);
        }

        // Department-wise breakdown: total, theory, lab, allocated, unallocated
        const [rows] = await db.query(`
            SELECT 
                d.id as dept_id,
                d.name as dept_name,
                d.short_code,
                COUNT(s.id) as total,
                SUM(CASE WHEN s.l_credit > 0 THEN 1 ELSE 0 END) as theory,
                SUM(CASE WHEN s.p_credit > 0 THEN 1 ELSE 0 END) as lab,
                SUM(CASE WHEN s.l_credit > 0 AND s.p_credit > 0 THEN 1 ELSE 0 END) as both_type,
                SUM(CASE WHEN s.is_nptel = 1 THEN 1 ELSE 0 END) as nptel_count,
                SUM(CASE WHEN s.is_nptel = 1 THEN IFNULL(s.total_credits, 0) ELSE 0 END) as nptel_credits,
                SUM(CASE WHEN s.is_nptel = 1 AND (s.subject_type = 'theory' OR UPPER(IFNULL(s.nptel_mode, 'BOTH')) IN ('THEORY', 'LECTURE')) THEN 1 ELSE 0 END) as nptel_theory,
                SUM(CASE WHEN s.is_nptel = 1 AND (s.subject_type = 'lab' OR UPPER(IFNULL(s.nptel_mode, 'BOTH')) IN ('LAB', 'PRACTICAL')) THEN 1 ELSE 0 END) as nptel_lab,
                SUM(CASE WHEN s.is_nptel = 1 AND (s.subject_type = 'both' AND UPPER(IFNULL(s.nptel_mode, 'BOTH')) NOT IN ('THEORY', 'LECTURE', 'LAB', 'PRACTICAL')) THEN 1 ELSE 0 END) as nptel_both,
                SUM(CASE WHEN EXISTS (
                    ${allocatedCondition}
                ) THEN 1 ELSE 0 END) as allocated,
                SUM(CASE WHEN NOT EXISTS (
                    ${allocatedCondition}
                ) THEN 1 ELSE 0 END) as unallocated
            FROM subjects s
            JOIN departments d ON s.department_id = d.id
            ${whereClause}
            GROUP BY d.id, d.name, d.short_code
            ORDER BY d.name ASC
        `, params);

        // Grand totals
        let absoluteTotalQuery = 'SELECT COUNT(id) as count FROM subjects WHERE is_active = 1';
        let absoluteParams = [];
        
        if (req.query.semester_type === 'odd') {
            absoluteTotalQuery += ' AND (semester % 2 != 0 OR semester IS NULL)';
        } else if (req.query.semester_type === 'even') {
            absoluteTotalQuery += ' AND (semester % 2 = 0 OR semester IS NULL)';
        }
        if (dept_id) {
            absoluteTotalQuery += ' AND department_id = ?';
            absoluteParams.push(dept_id);
        }
        const [[{ count: absolute_total }]] = await db.query(absoluteTotalQuery, absoluteParams);

        const totals = rows.reduce((acc, r) => ({
            absolute_total: absolute_total,
            total: acc.total + parseInt(r.total),
            theory: acc.theory + parseInt(r.theory),
            lab: acc.lab + parseInt(r.lab),
            both_type: acc.both_type + parseInt(r.both_type || 0),
            nptel_count: acc.nptel_count + parseInt(r.nptel_count || 0),
            nptel_credits: acc.nptel_credits + parseFloat(r.nptel_credits || 0),
            nptel_theory: acc.nptel_theory + parseInt(r.nptel_theory || 0),
            nptel_lab: acc.nptel_lab + parseInt(r.nptel_lab || 0),
            nptel_both: acc.nptel_both + parseInt(r.nptel_both || 0),
            allocated: acc.allocated + parseInt(r.allocated),
            unallocated: acc.unallocated + parseInt(r.unallocated),
        }), { absolute_total: absolute_total, total: 0, theory: 0, lab: 0, both_type: 0, nptel_count: 0, nptel_credits: 0, nptel_theory: 0, nptel_lab: 0, nptel_both: 0, allocated: 0, unallocated: 0 });

        res.json({ success: true, data: rows, totals });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/subjects
export const createSubject = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        let { department_id, full_name, short_code, subject_code, subject_type, total_credits, l_credit, t_credit, p_credit, semester, program_name, is_active, is_elective, is_nptel, nptel_mode, sections } = req.body;
        if (req.departmentId) {
            department_id = req.departmentId;
        }
        const active = is_active !== undefined ? is_active : 1;
        const elective = is_elective ? 1 : 0;
        const nptel = is_nptel ? 1 : 0;
        const mode = nptel ? (subject_type === 'theory' ? 'THEORY' : subject_type === 'lab' ? 'LAB' : (nptel_mode || 'BOTH').toUpperCase()) : 'NONE';
        
        // Generate short_code if missing
        if (!short_code) {
            short_code = full_name.split(' ').map(w => w[0]).join('').substring(0, 6).toUpperCase();
        }

        const [result] = await db.query(
            `INSERT INTO subjects (
                department_id, program_name, full_name, short_code, subject_code, subject_type, 
                total_credits, l_credit, t_credit, p_credit, semester, is_elective, is_nptel, nptel_mode, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [department_id, program_name || null, full_name, short_code, subject_code || null, subject_type, total_credits, l_credit || 0, t_credit || 0, p_credit || 0, semester || null, elective, nptel, mode, active]
        );

        const newSubjectId = result.insertId;

        // Map to specific sections if provided
        if (sections && Array.isArray(sections) && sections.length > 0) {
            const values = sections.map(secId => [newSubjectId, secId]);
            await db.query('INSERT IGNORE INTO subject_section_mapping (subject_id, section_id) VALUES ?', [values]);
        }

        res.status(201).json({ success: true, message: 'Subject created', id: newSubjectId });
    } catch (error) {
        next(error);
    }
};

// @route   PUT /api/subjects/:id
export const updateSubject = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { id } = req.params;
        let { department_id, full_name, short_code, subject_code, subject_type, total_credits, l_credit, t_credit, p_credit, semester, program_name, is_active, is_elective, is_nptel, nptel_mode, sections } = req.body;
        if (req.departmentId) {
            department_id = req.departmentId;
        }
        const active = is_active !== undefined ? is_active : 1;
        const elective = is_elective ? 1 : 0;
        const nptel = is_nptel ? 1 : 0;
        const mode = nptel ? (subject_type === 'theory' ? 'THEORY' : subject_type === 'lab' ? 'LAB' : (nptel_mode || 'BOTH').toUpperCase()) : 'NONE';

        if (!short_code) {
            short_code = full_name.split(' ').map(w => w[0]).join('').substring(0, 6).toUpperCase();
        }

        // Verify scope
        const [subCheck] = await db.query('SELECT department_id FROM subjects WHERE id = ?', [id]);
        if (subCheck.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
        if (req.departmentId && subCheck[0].department_id !== req.departmentId) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        await db.query(
            `UPDATE subjects SET 
                department_id = ?, program_name = ?, full_name = ?, short_code = ?, subject_code = ?, subject_type = ?, 
                total_credits = ?, l_credit = ?, t_credit = ?, p_credit = ?, semester = ?, is_elective = ?, is_nptel = ?, nptel_mode = ?, is_active = ? 
            WHERE id = ?`,
            [department_id, program_name || null, full_name, short_code, subject_code || null, subject_type, total_credits, l_credit || 0, t_credit || 0, p_credit || 0, semester || null, elective, nptel, mode, active, id]
        );

        // Update section mappings
        if (sections && Array.isArray(sections)) {
            await db.query('DELETE FROM subject_section_mapping WHERE subject_id = ?', [id]);
            if (sections.length > 0) {
                const values = sections.map(secId => [id, secId]);
                await db.query('INSERT IGNORE INTO subject_section_mapping (subject_id, section_id) VALUES ?', [values]);
            }
        }

        res.json({ success: true, message: 'Subject updated' });
    } catch (error) {
        next(error);
    }
};

// @route   DELETE /api/subjects/:id
export const deleteSubject = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        // Verify scope
        const [subCheck] = await db.query('SELECT department_id FROM subjects WHERE id = ?', [id]);
        if (subCheck.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
        if (req.departmentId && subCheck[0].department_id !== req.departmentId) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        const [result] = await db.query('DELETE FROM subjects WHERE id = ?', [id]);
        
        if (result.affectedRows > 0) {
            res.json({ success: true, message: 'Subject deleted successfully' });
        } else {
            res.status(404).json({ success: false, message: 'Subject not found' });
        }
    } catch (error) {
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(409).json({ success: false, message: 'Cannot delete: Subject is referenced in timetable or allocations.' });
        }
        next(error);
    }
};

// @route   POST /api/subjects/bulk
export const bulkUploadSubjects = async (req, res, next) => {
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
            if (d.name) {
                deptMap[d.name.toLowerCase().trim()] = d.id;
                deptMap[d.name.toLowerCase().replace(/[^a-z0-9]/g, '')] = d.id;
            }
            if (d.short_code) {
                deptMap[d.short_code.toLowerCase().trim()] = d.id;
                deptMap[d.short_code.toLowerCase().replace(/[^a-z0-9]/g, '')] = d.id;
            }
            deptMap[d.id.toString()] = d.id;
        });

        // Fetch all classes for fuzzy matching program names
        const [allClasses] = await db.query('SELECT DISTINCT program_name, department_id FROM classes');

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
                    const rowIndex = i + 2; // +1 for 0-index, +1 for header
                    
                    try {
                        const name = row['Subject Name']?.toString().trim();
                        const code = row['Subject Code']?.toString().trim();
                        let short_name = row['Short Name']?.toString().trim() || row['Short Code']?.toString().trim();
                        if (!short_name && name) {
                            short_name = name.split(' ').map(w => w[0]).join('').substring(0, 6).toUpperCase();
                        }
                        const dept = (
                            row['Department Code'] || 
                            row['Department'] || 
                            row['Department Short Name'] || 
                            row['Department Short Code'] || 
                            row['Dept Code'] || 
                            row['Dept'] || 
                            row['department_code'] || 
                            row['department']
                        )?.toString().trim();
                        const rawProgramStr = row['Course']?.toString().trim() || row['Program Name']?.toString().trim() || null;
                        const type = (row['Type'] || row['Type (theory/lab/both)'])?.toString().trim().toLowerCase();
                        
                        const l_credit = parseFloat(row['L']?.toString().trim() || row['Lecture Credits']?.toString().trim() || 0);
                        const t_credit = parseFloat(row['T']?.toString().trim() || row['Tutorial Credits']?.toString().trim() || 0);
                        const p_credit = parseFloat(row['P']?.toString().trim() || row['Practical Credits']?.toString().trim() || 0);
                        let total_credits = parseFloat(row['Total Credits']?.toString().trim() || row['Credits']?.toString().trim());
                        if (isNaN(total_credits)) {
                            total_credits = l_credit + p_credit; // Tutorial (T) is not counted towards total credits
                        }

                        let semesterStr = row['Semester']?.toString().trim() || '';
                        let semester = null;
                        if (semesterStr) {
                            const romanMap = {
                                'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5,
                                'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10
                            };
                            if (romanMap[semesterStr.toUpperCase()]) {
                                semester = romanMap[semesterStr.toUpperCase()];
                            } else {
                                semester = parseInt(semesterStr);
                                if (isNaN(semester)) semester = null;
                            }
                        }

                        let is_elective = 0;
                        const electiveStr = (row['Is Elective'] || row['Elective'])?.toString().trim().toLowerCase();
                        if (electiveStr === 'yes' || electiveStr === 'true' || electiveStr === '1') {
                            is_elective = 1;
                        }

                        let is_nptel = 0;
                        let nptel_mode = 'NONE';
                        const nptelStr = (row['Is NPTEL'] || row['NPTEL'] || row['MOOC'] || row['NPTEL/Swayam'])?.toString().trim().toLowerCase();
                        if (nptelStr === 'yes' || nptelStr === 'true' || nptelStr === '1') {
                            is_nptel = 1;
                            if (type === 'theory') nptel_mode = 'THEORY';
                            else if (type === 'lab') nptel_mode = 'LAB';
                            else {
                                const modeStr = (row['NPTEL Mode (THEORY/LAB/BOTH)'] || row['NPTEL Mode'] || row['MOOC Mode'] || row['NPTEL Type'])?.toString().trim().toUpperCase();
                                if (modeStr === 'THEORY' || modeStr === 'LECTURE') nptel_mode = 'THEORY';
                                else if (modeStr === 'LAB' || modeStr === 'PRACTICAL') nptel_mode = 'LAB';
                                else nptel_mode = 'BOTH';
                            }
                        }

                        let dept_id = req.departmentId || null;
                        if (!dept_id && dept) {
                            const normalizedDept = dept.toLowerCase().trim();
                            const strippedDept = dept.toLowerCase().replace(/[^a-z0-9]/g, '');
                            dept_id = deptMap[normalizedDept] || deptMap[strippedDept] || null;
                        }
                        
                        if (!dept_id) {
                            const availableCodes = departments.map(d => d.short_code).filter(Boolean).join(', ');
                            errors.push(`Row ${rowIndex}: Department '${dept || 'empty'}' not found. Please use valid Department Code (${availableCodes}) or Name.`);
                            continue;
                        }

                        if (!name || !short_name || !type) {
                            errors.push(`Row ${rowIndex}: Missing required fields (Subject Name, Short Name, Type) for Class '${rawProgramStr || 'N/A'}'`);
                            continue;
                        }

                        if (!['theory', 'lab', 'both'].includes(type)) {
                            errors.push(`Row ${rowIndex}: Invalid Type '${type}' for Subject '${name}'. Must be theory, lab, or both.`);
                            continue;
                        }

                        // Validation for Credits vs Type
                        if (type === 'lab' && l_credit > 0) {
                            errors.push(`Row ${rowIndex}: Subject '${name}' (Class: '${rawProgramStr || 'N/A'}') is a 'Lab' but has Lecture credits (L=${l_credit}). Lab subjects should have 0 Lecture credits.`);
                            continue;
                        }
                        if (type === 'lab' && p_credit === 0) {
                            errors.push(`Row ${rowIndex}: Subject '${name}' (Class: '${rawProgramStr || 'N/A'}') is a 'Lab' but has 0 Practical credits. Lab subjects must have P > 0.`);
                            continue;
                        }
                        if (type === 'theory' && p_credit > 0) {
                            errors.push(`Row ${rowIndex}: Subject '${name}' (Class: '${rawProgramStr || 'N/A'}') is a 'Theory' but has Practical credits (P=${p_credit}). Theory subjects should have 0 Practical credits.`);
                            continue;
                        }
                        if (l_credit > 6) {
                            errors.push(`Row ${rowIndex}: Subject '${name}' (Class: '${rawProgramStr || 'N/A'}') has invalid Lecture credits (L=${l_credit}). Maximum allowed is 6.`);
                            continue;
                        }
                        if (p_credit > 3) {
                            errors.push(`Row ${rowIndex}: Subject '${name}' (Class: '${rawProgramStr || 'N/A'}') has invalid Practical credits (P=${p_credit}). Maximum allowed is 3.`);
                            continue;
                        }

                        // Split program_name by + or 'and'
                        const rawPrograms = rawProgramStr ? rawProgramStr.split(/\+|(?: and )/i).map(c => c.trim()).filter(c => c) : [null];

                        for (const rawProgram of rawPrograms) {
                            let program_name = rawProgram;
                            
                            // Fuzzy matching for program_name
                            // Strip section suffixes like B1, B2, B3 (e.g., "BTech CSE (AI/ML) B1" -> "BTech CSE (AI/ML)")
                            if (program_name) {
                                const strippedInput = program_name.replace(/\s+[A-Z][0-9]+$/i, '').trim();
                                const cleanInput = strippedInput.replace(/[\s.\-]/g, '').toLowerCase();
                                const exactMatch = allClasses.find(c =>
                                    c.department_id === dept_id &&
                                    c.program_name &&
                                    c.program_name.replace(/[\s.\-]/g, '').toLowerCase() === cleanInput
                                );
                                if (exactMatch) {
                                    program_name = exactMatch.program_name;
                                } else {
                                    // Partial/substring match as fallback
                                    const partialMatch = allClasses.find(c =>
                                        c.department_id === dept_id &&
                                        c.program_name &&
                                        (
                                            c.program_name.toLowerCase().includes(strippedInput.toLowerCase()) ||
                                            strippedInput.toLowerCase().includes(c.program_name.toLowerCase())
                                        )
                                    );
                                    if (partialMatch) {
                                        program_name = partialMatch.program_name;
                                    }
                                    // else keep original (may not match any class but still insert subject)
                                }
                            }

                            // Duplicate check
                            const checkQuery = `
                                SELECT id, program_name FROM subjects 
                                WHERE full_name = ? AND department_id = ? AND subject_type = ? 
                                AND (program_name = ? OR (program_name IS NULL AND ? IS NULL))
                                AND (semester = ? OR (semester IS NULL AND ? IS NULL))
                            `;
                            const [existing] = await db.query(checkQuery, [name, dept_id, type, program_name, program_name, semester, semester]);
                            
                            if (existing.length > 0) {
                                errors.push(`Row ${rowIndex}: Skipped Duplicate - Subject '${name}' already exists for course '${existing[0].program_name || 'All Courses'}' (Conflict ID: ${existing[0].id}).`);
                                skippedCount++;
                                continue; // Continue to next course in loop
                            }

                            const [result] = await db.query(
                                `INSERT INTO subjects (
                                    department_id, program_name, full_name, short_code, subject_code, subject_type, 
                                    total_credits, l_credit, t_credit, p_credit, semester, is_elective, is_nptel, nptel_mode, is_active
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                [dept_id, program_name, name, short_name, code || null, type, total_credits, l_credit, t_credit, p_credit, semester, is_elective, is_nptel, nptel_mode, 1]
                            );
                            
                            const newSubjectId = result.insertId;

                            // Insert into subject_section_mapping for all sections of the specified program and semester
                            const sectionsQuery = `
                                SELECT sec.id 
                                FROM sections sec
                                JOIN classes c ON sec.class_id = c.id
                                WHERE c.department_id = ? 
                                AND (c.program_name = ? OR ? IS NULL)
                                AND (c.semester = ? OR ? IS NULL)
                            `;
                            const [matchedSections] = await db.query(sectionsQuery, [dept_id, program_name, program_name, semester, semester]);
                            
                            if (matchedSections.length > 0) {
                                const values = matchedSections.map(s => [newSubjectId, s.id]);
                                await db.query('INSERT IGNORE INTO subject_section_mapping (subject_id, section_id) VALUES ?', [values]);
                            }
                            
                            successCount++;
                        }
                    } catch (err) {
                        errors.push(`Row ${rowIndex}: Server error - ${err.message}`);
                    }
                }

        // Delete file after processing
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            summary: { total: results.length, inserted: successCount, skipped: skippedCount, errors: errors.length },
            message: `Bulk upload complete. Added ${successCount} subjects. Skipped ${skippedCount} duplicates.`,
            errors: errors.length > 0 ? errors : null
        });

    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        next(error);
    }
};

// @route   POST /api/subjects/bulk-delete
export const bulkDeleteSubjects = async (req, res, next) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'No subjects selected for deletion' });
        }
        
        const placeholders = ids.map(() => '?').join(',');
        let query = `DELETE FROM subjects WHERE id IN (${placeholders})`;
        const params = [...ids];
        if (req.departmentId) {
            query += " AND department_id = ?";
            params.push(req.departmentId);
        }
        const [result] = await db.query(query, params);
        
        res.json({ success: true, message: `${result.affectedRows} subjects deleted successfully` });
    } catch (error) {
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
             return res.status(409).json({ success: false, message: 'Some subjects cannot be deleted because they are currently in use.' });
        }
        next(error);
    }
};

// @route   POST /api/subjects/bulk-delete-by-department
export const deleteSubjectsByDepartment = async (req, res, next) => {
    try {
        const { department_ids, program_name, semester } = req.body;
        
        let deptIds = [];
        if (req.departmentId) {
            deptIds = [req.departmentId];
        } else if (Array.isArray(department_ids) && department_ids.length > 0) {
            deptIds = department_ids;
        }

        if (deptIds.length === 0) {
            return res.status(400).json({ success: false, message: 'Department IDs are required' });
        }

        const placeholders = deptIds.map(() => '?').join(',');
        let query = `DELETE FROM subjects WHERE department_id IN (${placeholders})`;
        const params = [...deptIds];

        if (program_name) {
            query += ` AND program_name = ?`;
            params.push(program_name);
        }
        if (semester) {
            query += ` AND semester = ?`;
            params.push(semester);
        }

        // Ensure none of the subjects are used in timetable before deleting
        // Or we can just try delete and catch the FK constraint error
        const [result] = await db.query(query, params);
        
        res.json({
            success: true,
            message: `Successfully deleted ${result.affectedRows} subjects.`
        });
    } catch (error) {
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
             return res.status(409).json({ success: false, message: 'Cannot delete subjects. Some subjects are currently assigned to sections or timetables.' });
        }
        next(error);
    }
};

// @route   POST /api/subjects/clear-nptel
export const clearAllNptel = async (req, res, next) => {
    try {
        const deptId = req.departmentId || req.body.department_id || null;
        let query = "UPDATE subjects SET is_nptel = 0, nptel_mode = 'BOTH' WHERE is_nptel = 1";
        const params = [];
        if (deptId) {
            query += " AND department_id = ?";
            params.push(deptId);
        }
        const [result] = await db.query(query, params);
        res.json({
            success: true,
            message: `Successfully reset NPTEL / MOOC flag for ${result.affectedRows} subjects.`,
            affectedRows: result.affectedRows
        });
    } catch (error) {
        next(error);
    }
};

export const getOverviewDetails = async (req, res, next) => {
    try {
        const dept_id = req.departmentId || req.query.department_id || null;
        const sessionId = req.query.session_id ? parseInt(req.query.session_id) : null;
        const sessionFilter = sessionId ? ` AND c.session_id = ${sessionId}` : '';

        let whereClause = `WHERE (s.id IS NULL OR (s.is_active = 1 AND (s.is_elective = 0 OR EXISTS (
            SELECT 1 FROM class_electives ce JOIN classes c ON ce.class_id = c.id WHERE ce.subject_id = s.id AND c.is_active = 1${sessionFilter}
        ))))`;
        if (req.query.semester_type === 'odd') {
            whereClause = `WHERE (s.id IS NULL OR (s.is_active = 1 AND (s.semester % 2 != 0 OR s.semester IS NULL) AND (s.is_elective = 0 OR EXISTS (
                SELECT 1 FROM class_electives ce JOIN classes c ON ce.class_id = c.id WHERE ce.subject_id = s.id AND c.is_active = 1${sessionFilter}
            ))))`;
        } else if (req.query.semester_type === 'even') {
            whereClause = `WHERE (s.id IS NULL OR (s.is_active = 1 AND (s.semester % 2 = 0 OR s.semester IS NULL) AND (s.is_elective = 0 OR EXISTS (
                SELECT 1 FROM class_electives ce JOIN classes c ON ce.class_id = c.id WHERE ce.subject_id = s.id AND c.is_active = 1${sessionFilter}
            ))))`;
        }
        const paramsDept = [];
        if (dept_id) {
            whereClause += ' AND d.id = ?';
            paramsDept.push(dept_id);
        }

        let allocatedCondition = 'SELECT 1 FROM section_subjects ss WHERE ss.subject_id = s.id LIMIT 1';
        if (req.query.session_id) {
            allocatedCondition = `
                SELECT 1 FROM section_subjects ss 
                JOIN sections sec ON ss.section_id = sec.id 
                JOIN classes c ON sec.class_id = c.id 
                WHERE ss.subject_id = s.id AND c.session_id = ? LIMIT 1
            `;
            paramsDept.push(req.query.session_id, req.query.session_id);
        }

        // 1. Department-wise stats (Total Subjects and Active Electives)
        const [departmentStats] = await db.query(`
            SELECT 
                d.id as dept_id,
                d.name as department_name,
                d.short_code,
                COUNT(s.id) as total_subjects,
                SUM(CASE WHEN s.is_elective = 1 THEN 1 ELSE 0 END) as total_active_electives,
                SUM(CASE WHEN s.l_credit > 0 THEN 1 ELSE 0 END) as theory,
                SUM(CASE WHEN s.p_credit > 0 THEN 1 ELSE 0 END) as lab,
                SUM(CASE WHEN s.is_nptel = 1 THEN 1 ELSE 0 END) as nptel,
                SUM(CASE WHEN EXISTS (${allocatedCondition}) THEN 1 ELSE 0 END) as allocated,
                SUM(CASE WHEN NOT EXISTS (${allocatedCondition}) THEN 1 ELSE 0 END) as unallocated
            FROM departments d
            LEFT JOIN subjects s ON s.department_id = d.id
            ${whereClause}
            GROUP BY d.id, d.name, d.short_code
            ORDER BY d.name ASC
        `, paramsDept);

        // 2. NPTEL subjects and their mappings
        let whereNptel = 'WHERE s.is_nptel = 1';
        const paramsNptel = [];
        if (dept_id) {
            whereNptel += ' AND s.department_id = ?';
            paramsNptel.push(dept_id);
        }
        if (req.query.semester_type === 'odd') {
            whereNptel += ' AND (s.semester % 2 != 0 OR s.semester IS NULL)';
        } else if (req.query.semester_type === 'even') {
            whereNptel += ' AND (s.semester % 2 = 0 OR s.semester IS NULL)';
        }

        const [nptelSubjects] = await db.query(`
            SELECT 
                s.id as subject_id,
                s.full_name as subject_name,
                s.nptel_mode,
                d.short_code as department_code,
                c.program_name,
                c.semester,
                sec.section_name
            FROM subjects s
            JOIN departments d ON s.department_id = d.id
            JOIN section_subjects ss ON ss.subject_id = s.id
            JOIN sections sec ON ss.section_id = sec.id
            JOIN classes c ON sec.class_id = c.id
            ${whereNptel}
            ORDER BY d.name ASC, c.program_name ASC, s.full_name ASC
        `, paramsNptel);

        res.json({
            success: true,
            data: {
                departmentStats,
                nptelSubjects
            }
        });
    } catch (error) {
        next(error);
    }
};
