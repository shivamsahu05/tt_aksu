import db from '../config/db.js';
import { validationResult } from 'express-validator';
import fs from 'fs';
import csv from 'csv-parser';
import xlsx from 'xlsx';

// @route   GET /api/allocations
// Get all allocations, optionally filtered by session_id, class_id, section_id
export const getAllocations = async (req, res, next) => {
    try {
        const { session_id, class_id, section_id, teacher_id } = req.query;

        let query = `
            SELECT ss.*, 
                   s.full_name as subject_name, s.short_code as subject_code, s.subject_type, s.total_credits, s.l_credit, s.t_credit, s.p_credit, s.is_nptel, s.nptel_mode, s.department_id as subject_department_id,
                   t.full_name as teacher_name, t.employee_code, t.photo,
                   sec.section_name,
                   c.program_name, c.semester,
                   sess.name as session_name
            FROM section_subjects ss
            JOIN subjects s ON ss.subject_id = s.id
            JOIN teachers t ON ss.teacher_id = t.id
            JOIN sections sec ON ss.section_id = sec.id
            JOIN classes c ON sec.class_id = c.id
            JOIN academic_sessions sess ON c.session_id = sess.id
        `;
        const params = [];
        const whereConditions = [];

        if (section_id) {
            whereConditions.push('ss.section_id = ?');
            params.push(section_id);
        } else if (class_id) {
            whereConditions.push('sec.class_id = ?');
            params.push(class_id);
        } 
        
        if (session_id) {
            whereConditions.push('c.session_id = ?');
            params.push(session_id);
        }
        
        if (teacher_id) {
            whereConditions.push('ss.teacher_id = ?');
            params.push(teacher_id);
        }

        if (whereConditions.length > 0) {
            query += ' WHERE ' + whereConditions.join(' AND ');
            if (req.departmentId) {
                query += ' AND c.department_id = ' + db.escape(req.departmentId);
            }
        } else if (req.departmentId) {
            query += ' WHERE c.department_id = ' + db.escape(req.departmentId);
        }

        query += ' ORDER BY c.program_name ASC, sec.section_name ASC, s.full_name ASC';
        
        const [rows] = await db.query(query, params);

        res.json({ success: true, data: rows });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/allocations/available-subjects
// Get subjects that are NOT YET assigned to the given section
export const getAvailableSubjects = async (req, res, next) => {
    try {
        let { section_id, department_id, semester } = req.query;
        if (req.departmentId) department_id = req.departmentId;
        
        if (!section_id) {
            return res.status(400).json({ success: false, message: 'Section ID is required' });
        }

        const [classInfo] = await db.query('SELECT c.id as class_id, c.program_name, c.semester FROM sections sec JOIN classes c ON sec.class_id = c.id WHERE sec.id = ?', [section_id]);
        if (classInfo.length === 0) return res.status(404).json({ success: false, message: 'Section not found' });
        
        const { class_id, program_name, semester: class_sem } = classInfo[0];
        
        let query = `
            SELECT s.*, ce.class_id as elective_class_id
            FROM subjects s
            LEFT JOIN class_electives ce ON s.id = ce.subject_id AND ce.class_id = ?
            WHERE s.is_active = 1
            AND (
                (s.subject_type IN ('theory', 'both') AND NOT EXISTS (SELECT 1 FROM section_subjects ss WHERE ss.subject_id = s.id AND ss.section_id = ? AND ss.allocation_type = 'theory'))
                OR
                (s.subject_type IN ('lab', 'both') AND NOT EXISTS (SELECT 1 FROM section_subjects ss WHERE ss.subject_id = s.id AND ss.section_id = ? AND ss.allocation_type = 'lab'))
            )
        `;
        const params = [class_id, section_id, section_id];

        if (department_id) {
            query += ' AND s.department_id = ?';
            params.push(department_id);
        }
        
        query += ' ORDER BY s.full_name ASC';

        const [rows] = await db.query(query, params);
        
        const uniqueTracker = new Set();
        const filteredSubjects = rows.filter(sub => {
            let isMatch = false;
            if (sub.is_elective === 1) {
                isMatch = sub.elective_class_id === class_id;
            } else {
                if (!sub.program_name && sub.semester === class_sem) isMatch = true;
                else if (sub.program_name) {
                    const strippedSubProg = sub.program_name.replace(/\s+[A-Z][0-9]+$/i, '').trim();
                    const normSubProg = strippedSubProg.replace(/[\s.\-]/g, '').toLowerCase();
                    const strippedClassProg = program_name.replace(/\s+[A-Z][0-9]+$/i, '').trim();
                    const normClassProg = strippedClassProg.replace(/[\s.\-]/g, '').toLowerCase();
                    if (normSubProg === normClassProg && sub.semester === class_sem) isMatch = true;
                }
            }
            if (isMatch) {
                const key = `${sub.full_name}-${sub.subject_type}`;
                if (!uniqueTracker.has(key)) {
                    uniqueTracker.add(key);
                    return true;
                }
            }
            return false;
        });
        
        res.json({ success: true, data: filteredSubjects });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/allocations/matrix
// Get matrix view of classes -> sections -> subjects -> teacher assigned
export const getAllocationMatrix = async (req, res, next) => {
    try {
        const { session_id, department_id } = req.query;

        if (!session_id || !department_id) {
            return res.status(400).json({ success: false, message: 'Session ID and Department ID are required' });
        }

        // 1. Fetch classes and sections for this department
        const [sectionsData] = await db.query(`
            SELECT c.id as class_id, c.program_name, c.semester, sec.id as section_id, sec.section_name,
                   c.class_teacher_id, t.full_name as class_teacher_name
            FROM classes c
            LEFT JOIN teachers t ON c.class_teacher_id = t.id
            JOIN sections sec ON c.id = sec.class_id
            WHERE c.department_id = ? AND c.session_id = ? AND c.is_active = 1
            ORDER BY c.semester ASC, c.program_name ASC, sec.section_name ASC
        `, [department_id, session_id]);

        if (sectionsData.length === 0) {
            return res.json({ success: true, data: [] });
        }

        // 2. Fetch all subjects for this department
        const [subjectsData] = await db.query(`
            SELECT s.id, s.full_name, s.short_code, s.subject_type, s.semester, s.total_credits, s.l_credit, s.t_credit, s.p_credit, s.program_name, s.is_elective, s.is_nptel, s.nptel_mode,
                   ce.class_id as elective_class_id
            FROM subjects s
            LEFT JOIN class_electives ce ON s.id = ce.subject_id
            WHERE s.department_id = ? AND s.is_active = 1
        `, [department_id]);

        // 3. Fetch all current allocations for these sections
        const sectionIds = sectionsData.map(s => s.section_id);
        const [allocationsData] = await db.query(`
            SELECT ss.id as allocation_id, ss.section_id, ss.subject_id, ss.teacher_id, ss.allocation_type, ss.room_id, ss.is_online, ss.conduct_in_teacher_dept,
                   t.full_name as teacher_name, t.short_name as teacher_short_name
            FROM section_subjects ss
            LEFT JOIN teachers t ON ss.teacher_id = t.id
            WHERE ss.section_id IN (?)
        `, [sectionIds]);

        // 4. Assemble the nested matrix
        // Group by Class
        const classMap = new Map();

        sectionsData.forEach(row => {
            if (!classMap.has(row.class_id)) {
                classMap.set(row.class_id, {
                    class_id: row.class_id,
                    program_name: row.program_name,
                    semester: row.semester,
                    class_teacher_id: row.class_teacher_id,
                    class_teacher_name: row.class_teacher_name,
                    sections: []
                });
            }
            
            const classObj = classMap.get(row.class_id);
            
            // Find subjects mapped to this specific section (dynamic matching based on class program and semester)
            const uniqueTracker = new Set();
            // Normalize class program name for comparison
            const normalizedClassName = row.program_name ? row.program_name.replace(/[\s.\-]/g, '').toLowerCase() : '';
            const classSubjects = subjectsData.filter(sub => {
                let isMatch = false;
                if (sub.is_elective === 1) {
                    isMatch = sub.elective_class_id === row.class_id;
                } else {
                    if (!sub.program_name && sub.semester === row.semester) {
                        isMatch = true;
                    } else if (sub.program_name && row.program_name) {
                        // Normalize subject program name - strip B1/B2 suffixes
                        const strippedSubProgram = sub.program_name.replace(/\s+[A-Z][0-9]+$/i, '').trim();
                        const normalizedSubProgram = strippedSubProgram.replace(/[\s.\-]/g, '').toLowerCase();
                        if (normalizedSubProgram === normalizedClassName && sub.semester === row.semester) {
                            isMatch = true;
                        }
                    }
                }
                if (isMatch) {
                    const key = `${sub.full_name}-${sub.subject_type}`;
                    if (!uniqueTracker.has(key)) {
                        uniqueTracker.add(key);
                        return true;
                    }
                }
                return false;
            });
            
            const sectionObj = {
                section_id: row.section_id,
                section_name: row.section_name,
                subjects: classSubjects.map(sub => {
                    // Find allocations for this specific subject and section
                    const subAllocations = allocationsData.filter(a => a.section_id === row.section_id && a.subject_id === sub.id);
                    
                    let theoryAllocation = subAllocations.find(a => a.allocation_type === 'theory') || null;
                    let labAllocation = subAllocations.find(a => a.allocation_type === 'lab') || null;

                    return {
                        ...sub,
                        allocations: {
                            theory: theoryAllocation,
                            lab: labAllocation
                        }
                    };
                })
            };
            
            classObj.sections.push(sectionObj);
        });

        res.json({ success: true, data: Array.from(classMap.values()) });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/allocations/teachers-workload
// Get teachers and their current subject count/workload for a session
export const getTeachersWorkload = async (req, res, next) => {
    try {
        const { session_id, department_id } = req.query;

        let query = `
            SELECT t.id, t.department_id, t.full_name, t.short_name, t.employee_code, t.designation, t.photo, d.name as department_name,
                   COUNT(ss.id) as subject_count,
                   SUM(CASE WHEN ss.allocation_type = 'theory' THEN IFNULL(s.l_credit, s.total_credits) ELSE 0 END) as total_theory_credits,
                   SUM(CASE WHEN ss.allocation_type = 'lab' THEN IFNULL(s.p_credit, 1) ELSE 0 END) as total_lab_credits
            FROM teachers t
            LEFT JOIN departments d ON t.department_id = d.id
            LEFT JOIN section_subjects ss ON t.id = ss.teacher_id
            LEFT JOIN subjects s ON ss.subject_id = s.id
            LEFT JOIN sections sec ON ss.section_id = sec.id
            LEFT JOIN classes c ON sec.class_id = c.id ${session_id ? 'AND c.session_id = ?' : ''}
            WHERE t.is_active = 1
              AND LOWER(t.full_name) NOT LIKE '%class teacher%' 
              AND LOWER(t.short_name) NOT LIKE '%class teacher%'
              AND LOWER(IFNULL(t.designation, '')) NOT LIKE '%class teacher%'
        `;
        const params = [];
        if (session_id) params.push(session_id);

        if (department_id) {
            query += ' AND (t.department_id = ? OR (t.secondary_departments IS NOT NULL AND t.secondary_departments != "" AND (JSON_CONTAINS(t.secondary_departments, ?) OR JSON_CONTAINS(t.secondary_departments, ?))))';
            params.push(department_id, `"${department_id}"`, department_id.toString());
        }

        query += ' GROUP BY t.id, t.department_id, t.full_name, t.short_name, t.employee_code, t.designation, t.photo, d.name';
        query += ' ORDER BY subject_count DESC, t.full_name ASC';

        const [rows] = await db.query(query, params);
        res.json({ success: true, data: rows });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/allocations
export const createAllocation = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { section_id, subject_id, teacher_id, allocation_type = 'theory', is_class_teacher, room_id = null, is_online = 0, conduct_in_teacher_dept = 0 } = req.body;

        // Check scope
        if (req.departmentId) {
            const [deptCheck] = await db.query('SELECT c.department_id FROM sections sec JOIN classes c ON sec.class_id = c.id WHERE sec.id = ?', [section_id]);
            if (deptCheck.length > 0 && deptCheck[0].department_id !== req.departmentId) {
                return res.status(403).json({ success: false, message: 'Forbidden' });
            }
        }

        const [existing] = await db.query(
            'SELECT id FROM section_subjects WHERE section_id = ? AND subject_id = ? AND allocation_type = ?', 
            [section_id, subject_id, allocation_type]
        );
        
        if (existing.length > 0) {
            // Self-heal: If an orphaned or hidden allocation exists, update it instead of failing
            await db.query(
                'UPDATE section_subjects SET teacher_id = ?, room_id = ?, is_online = ?, conduct_in_teacher_dept = ? WHERE id = ?',
                [teacher_id, room_id, is_online ? 1 : 0, conduct_in_teacher_dept ? 1 : 0, existing[0].id]
            );
            
            if (is_class_teacher) {
                const [secRows] = await db.query('SELECT class_id FROM sections WHERE id = ?', [section_id]);
                if (secRows.length > 0) {
                    await db.query('UPDATE classes SET class_teacher_id = ? WHERE id = ?', [teacher_id, secRows[0].class_id]);
                }
            }
            return res.status(200).json({ success: true, message: 'Allocation updated successfully (self-healed)', id: existing[0].id });
        }

        const [result] = await db.query(
            'INSERT INTO section_subjects (section_id, subject_id, teacher_id, allocation_type, room_id, is_online, conduct_in_teacher_dept) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [section_id, subject_id, teacher_id, allocation_type, room_id, is_online ? 1 : 0, conduct_in_teacher_dept ? 1 : 0]
        );

        if (is_class_teacher) {
            const [secRows] = await db.query('SELECT class_id FROM sections WHERE id = ?', [section_id]);
            if (secRows.length > 0) {
                await db.query('UPDATE classes SET class_teacher_id = ? WHERE id = ?', [teacher_id, secRows[0].class_id]);
            }
        }

        res.status(201).json({ success: true, message: 'Allocation successful', id: result.insertId });
    } catch (error) {
        next(error);
    }
};

// @route   PUT /api/allocations/:id
export const updateAllocation = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { id } = req.params;
        const { teacher_id, is_class_teacher, room_id = null, is_online = 0, conduct_in_teacher_dept = 0 } = req.body;
        
        // Check scope
        if (req.departmentId) {
            const [deptCheck] = await db.query('SELECT c.department_id FROM section_subjects ss JOIN sections sec ON ss.section_id = sec.id JOIN classes c ON sec.class_id = c.id WHERE ss.id = ?', [id]);
            if (deptCheck.length > 0 && deptCheck[0].department_id !== req.departmentId) {
                return res.status(403).json({ success: false, message: 'Forbidden' });
            }
        }

        const [result] = await db.query(
            'UPDATE section_subjects SET teacher_id = ?, room_id = ?, is_online = ?, conduct_in_teacher_dept = ? WHERE id = ?',
            [teacher_id, room_id, is_online ? 1 : 0, conduct_in_teacher_dept ? 1 : 0, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Allocation not found' });
        }

        if (is_class_teacher) {
            // Get the class_id from the allocation
            const [allocRows] = await db.query(`
                SELECT sec.class_id 
                FROM section_subjects ss
                JOIN sections sec ON ss.section_id = sec.id
                WHERE ss.id = ?
            `, [id]);
            
            if (allocRows.length > 0) {
                await db.query('UPDATE classes SET class_teacher_id = ? WHERE id = ?', [teacher_id, allocRows[0].class_id]);
            }
        }

        res.json({ success: true, message: 'Allocation updated successfully' });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/allocations/:id/toggle-online
export const toggleOnlineStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { is_online } = req.body;

        if (req.departmentId) {
            const [deptCheck] = await db.query('SELECT c.department_id FROM section_subjects ss JOIN sections sec ON ss.section_id = sec.id JOIN classes c ON sec.class_id = c.id WHERE ss.id = ?', [id]);
            if (deptCheck.length > 0 && deptCheck[0].department_id !== req.departmentId) {
                return res.status(403).json({ success: false, message: 'Forbidden' });
            }
        }

        const [result] = await db.query(
            'UPDATE section_subjects SET is_online = ? WHERE id = ?',
            [is_online ? 1 : 0, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Allocation not found' });
        }

        res.json({ success: true, message: `Allocation marked as ${is_online ? 'Online' : 'Offline'} successfully`, is_online: is_online ? 1 : 0 });
    } catch (error) {
        next(error);
    }
};

// @route   DELETE /api/allocations/:id
export const deleteAllocation = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        // Check scope
        if (req.departmentId) {
            const [deptCheck] = await db.query('SELECT c.department_id FROM section_subjects ss JOIN sections sec ON ss.section_id = sec.id JOIN classes c ON sec.class_id = c.id WHERE ss.id = ?', [id]);
            if (deptCheck.length > 0 && deptCheck[0].department_id !== req.departmentId) {
                return res.status(403).json({ success: false, message: 'Forbidden' });
            }
        }

        const [result] = await db.query('DELETE FROM section_subjects WHERE id = ?', [id]);
        
        if (result.affectedRows > 0) {
            res.json({ success: true, message: 'Allocation removed successfully' });
        } else {
            res.status(404).json({ success: false, message: 'Allocation not found' });
        }
    } catch (error) {
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(409).json({ success: false, message: 'Cannot remove allocation: it is referenced in the timetable.' });
        }
        next(error);
    }
};

// @route   GET /api/allocations/elective-preview
// Returns per-class elective status so the client can warn the user before downloading template
export const electivePreview = async (req, res, next) => {
    try {
        let { department_id, session_id } = req.query;
        if (req.departmentId) department_id = req.departmentId;

        if (!department_id || !session_id) {
            return res.status(400).json({ success: false, message: 'Department and Session IDs are required' });
        }

        // Get all elective subjects in this department
        const [electiveSubjects] = await db.query(`
            SELECT s.id, s.full_name, s.short_code, s.semester, s.program_name
            FROM subjects s
            WHERE s.department_id = ? AND s.is_elective = 1 AND s.is_active = 1
        `, [department_id]);

        if (electiveSubjects.length === 0) {
            return res.json({ success: true, hasElectives: false, classes: [] });
        }

        // Get all classes for this dept+session with their selected electives
        const [classesData] = await db.query(`
            SELECT c.id as class_id, c.program_name, c.semester,
                   ce.subject_id as selected_elective_id,
                   s.full_name as elective_name, s.short_code as elective_code
            FROM classes c
            LEFT JOIN class_electives ce ON ce.class_id = c.id
            LEFT JOIN subjects s ON s.id = ce.subject_id AND s.is_elective = 1
            WHERE c.department_id = ? AND c.session_id = ? AND c.is_active = 1
            ORDER BY c.semester ASC, c.program_name ASC
        `, [department_id, session_id]);

        // Group by class
        const classMap = {};
        classesData.forEach(row => {
            if (!classMap[row.class_id]) {
                classMap[row.class_id] = {
                    class_id: row.class_id,
                    program_name: row.program_name,
                    semester: row.semester,
                    selected_electives: []
                };
            }
            if (row.selected_elective_id) {
                classMap[row.class_id].selected_electives.push({
                    id: row.selected_elective_id,
                    name: row.elective_name,
                    code: row.elective_code
                });
            }
        });

        // Helper: check if an elective subject is relevant to a class
        // An elective is relevant to a class if:
        //   - elective has no program_name → it applies to all classes of that semester
        //   - elective has a program_name → it must match the class's program_name (normalized) AND same semester
        const normalize = (str) => str ? str.replace(/[\s.\-]/g, '').toLowerCase() : '';
        const stripSection = (str) => str ? str.replace(/\s+[A-Z][0-9]+$/i, '').trim() : str;

        const isElectiveRelevantToClass = (elective, cls) => {
            if (elective.semester !== cls.semester) return false;
            if (!elective.program_name) return true; // global elective for all classes of this semester
            const normElective = normalize(stripSection(elective.program_name));
            const normClass = normalize(cls.program_name);
            return normElective === normClass;
        };

        // Find elective subjects relevant to each class (semester + program_name match)
        const classResults = Object.values(classMap).map(cls => {
            const relevantElectives = electiveSubjects.filter(e => isElectiveRelevantToClass(e, cls));
            const notSelected = relevantElectives.filter(
                e => !cls.selected_electives.some(sel => sel.id === e.id)
            );
            return {
                ...cls,
                relevant_elective_count: relevantElectives.length,
                not_selected_electives: notSelected.map(e => ({ id: e.id, name: e.full_name, code: e.short_code }))
            };
        }).filter(cls => cls.relevant_elective_count > 0); // Only classes that have relevant electives

        return res.json({ success: true, hasElectives: true, classes: classResults });
    } catch (error) {
        next(error);
    }
};


export const bulkTemplate = async (req, res, next) => {
    try {
        let { department_id, session_id } = req.query;
        if (req.departmentId) department_id = req.departmentId;

        if (!department_id || !session_id) {
            return res.status(400).json({ success: false, message: 'Department and Session IDs are required' });
        }

        // Fetch sections
        const [sectionsData] = await db.query(`
            SELECT c.id as class_id, c.program_name, c.semester,
                   sec.id as section_id, sec.section_name
            FROM classes c
            JOIN sections sec ON c.id = sec.class_id
            WHERE c.department_id = ? AND c.session_id = ?
            ORDER BY c.semester ASC, c.program_name ASC, sec.section_name ASC
        `, [department_id, session_id]);

        // Fetch subjects
        const [subjectsData] = await db.query(`
            SELECT s.id, s.full_name, s.short_code, s.subject_type, s.semester,
                   s.total_credits, s.l_credit, s.t_credit, s.p_credit,
                   s.program_name, s.is_elective,
                   ce.class_id as elective_class_id
            FROM subjects s
            LEFT JOIN class_electives ce ON s.id = ce.subject_id
            WHERE s.department_id = ? AND s.is_active = 1
        `, [department_id]);

        // Fetch allocations
        const sectionIds = sectionsData.map(s => s.section_id);
        let allocationsData = [];
        if (sectionIds.length > 0) {
            [allocationsData] = await db.query(`
                SELECT ss.section_id, ss.subject_id, ss.allocation_type, t.full_name, t.employee_code
                FROM section_subjects ss
                JOIN teachers t ON ss.teacher_id = t.id
                WHERE ss.section_id IN (?)
            `, [sectionIds]);
        }

        let csvLines = ['Class,Semester,Section,Subject Code,Subject Name,Credits,Allocation Type,Teacher Name,Teacher Employee ID'];
        
        sectionsData.forEach(row => {
            const normalizedClassName = row.program_name ? row.program_name.replace(/[\s.\-]/g, '').toLowerCase() : '';
            const classSubjects = subjectsData.filter(sub => {
                let isMatch = false;
                if (sub.is_elective === 1) {
                    isMatch = sub.elective_class_id === row.class_id;
                } else {
                    if (!sub.program_name && sub.semester === row.semester) {
                        isMatch = true;
                    } else if (sub.program_name && row.program_name) {
                        const strippedSubProgram = sub.program_name.replace(/\s+[A-Z][0-9]+$/i, '').trim();
                        const normalizedSubProgram = strippedSubProgram.replace(/[\s.\-]/g, '').toLowerCase();
                        if (normalizedSubProgram === normalizedClassName && sub.semester === row.semester) {
                            isMatch = true;
                        }
                    }
                }
                return isMatch;
            });

            // Unique subjects logic
            const uniqueTracker = new Set();
            const finalSubjects = classSubjects.filter(sub => {
                const key = `${sub.full_name}-${sub.subject_type}`;
                if (!uniqueTracker.has(key)) {
                    uniqueTracker.add(key);
                    return true;
                }
                return false;
            });

            finalSubjects.forEach(sub => {
                let types = [];
                if (sub.subject_type === 'both') types = ['theory', 'lab'];
                else if (sub.subject_type === 'practical') types = ['lab'];
                else types = [sub.subject_type];
                
                types.forEach(type => {
                    const alloc = allocationsData.find(a => a.section_id === row.section_id && a.subject_id === sub.id && a.allocation_type === type);
                    
                    const pName = `"${row.program_name}"`;
                    const sem = row.semester;
                    const sName = `"${row.section_name}"`;
                    const code = `"${sub.short_code}"`;
                    const subName = `"${sub.full_name}"`;
                    
                    // Show correct credits per allocation type:
                    // Theory (Lecture) rows → l_credit (lecture credits only)
                    // Lab (Practical) rows  → p_credit (practical credits only)
                    let credits;
                    if (type === 'theory') {
                        credits = sub.l_credit || sub.total_credits || 0;
                    } else {
                        credits = sub.p_credit || 0;
                    }
                    
                    const aType = type;
                    let tName = '';
                    let eCode = '';
                    
                    if (req.query.include_assigned !== 'false' && alloc) {
                        tName = `"${alloc.full_name}"`;
                        eCode = alloc.employee_code ? `"${alloc.employee_code}"` : '';
                    }
                    
                    csvLines.push(`${pName},${sem},${sName},${code},${subName},${credits},${aType},${tName},${eCode}`);
                });
            });
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=allocations_template.csv');
        res.send(csvLines.join('\n'));
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/allocations/bulk-upload
export const bulkUpload = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Please upload a CSV file' });
        }

        const { session_id, department_id } = req.body;
        if (!session_id || !department_id) {
            return res.status(400).json({ success: false, message: 'Session and Department are required' });
        }

        let rows = [];
        let rowCount = 0;
        let successCount = 0;
        let skippedCount = 0;
        const errors = [];

        // Load mappings
        const [sectionsData] = await db.query(`
            SELECT c.id as class_id, c.program_name, c.semester,
                   sec.id as section_id, sec.section_name
            FROM classes c
            JOIN sections sec ON c.id = sec.class_id
            WHERE c.department_id = ? AND c.session_id = ?
        `, [department_id, session_id]);
        
        const [subjectsData] = await db.query(`
            SELECT s.id, s.full_name, s.short_code, s.subject_type, s.semester,
                   s.program_name, s.is_elective,
                   ce.class_id as elective_class_id
            FROM subjects s
            LEFT JOIN class_electives ce ON s.id = ce.subject_id
            WHERE s.department_id = ? AND s.is_active = 1
        `, [department_id]);

        const [teachersData] = await db.query(`
            SELECT id, full_name, employee_code, department_id FROM teachers WHERE is_active = 1
        `);

        try {
            const workbook = xlsx.readFile(req.file.path);
            const sheetName = workbook.SheetNames[0];
            rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
        } catch (err) {
            fs.unlink(req.file.path, () => {});
            return res.status(400).json({ success: false, message: 'Invalid CSV or Excel file format' });
        }

        for (const data of rows) {
            rowCount++;
            
            const getVal = (key) => {
                const foundKey = Object.keys(data).find(k => k.trim().toLowerCase() === key.toLowerCase());
                return foundKey ? data[foundKey].toString().trim() : '';
            };

            const program = getVal('Class');
            const semStr = getVal('Semester');
            const sem = parseInt(semStr);
            const section = getVal('Section');
            const subCode = getVal('Subject Code') || getVal('Subject');
            const allocType = getVal('Allocation Type').toLowerCase();
            const tName = getVal('Teacher Name');
            const eCode = getVal('Teacher Employee ID');

            if (!program || !sem || !section || !subCode || !allocType) {
                continue; // completely empty or invalid row
            }

            // Skip rows where teacher is a known placeholder (online, ibm, etc.)
            const tNameLower = tName.toLowerCase();
            const isKnownPlaceholder = tNameLower === 'online' || tNameLower === 'ibm' ||
                tNameLower === 'nptel' || tNameLower === 'swayam';
            if (isKnownPlaceholder) {
                skippedCount++;
                continue;
            }
            // Rows with blank teacher name: add to errors so user knows they need to fill these
            if (!tName && !eCode) {
                errors.push(`Row ${rowCount}: No teacher specified for '${subCode}' (${getVal('Allocation Type')}) in ${program} Sem ${semStr} ${section}. Fill in teacher name/ID and re-upload.`);
                continue;
            }

            try {
                // Find section
                const cleanProgram = program.replace(/[\s.\-]/g, '').toLowerCase();
                const cleanSection = section.toLowerCase();
                const matchedSec = sectionsData.find(s => {
                    const secProgram = s.program_name ? s.program_name.replace(/[\s.\-]/g, '').toLowerCase() : '';
                    return secProgram === cleanProgram && 
                           s.semester === sem && 
                           (s.section_name && s.section_name.toLowerCase() === cleanSection);
                });

                if (!matchedSec) {
                    errors.push(`Row ${rowCount}: Section '${program} Sem ${sem} ${section}' not found.`);
                    continue;
                }

                // Find subject
                // Build all candidate subjects with this code that match semester/program
                const cleanSubCode = subCode.toLowerCase();
                const candidateSubjects = subjectsData.filter(s => {
                    const isCodeMatch = (s.short_code && s.short_code.toLowerCase() === cleanSubCode) || 
                                        (s.full_name && s.full_name.toLowerCase() === cleanSubCode);
                    if (!isCodeMatch) return false;

                    // Match program and semester
                    const strippedSubProgram = (s.program_name || '').replace(/\s+[A-Z][0-9]+$/i, '').trim();
                    const normalizedSubProgram = strippedSubProgram.replace(/[\s.\-]/g, '').toLowerCase();
                    
                    if (!s.program_name && s.semester === sem) return true;
                    if (normalizedSubProgram === cleanProgram && s.semester === sem) return true;
                    if (s.is_elective === 1 && s.elective_class_id && s.elective_class_id === matchedSec.class_id) return true;

                    return false;
                });

                // Priority: For lab allocations, prefer 'both' type FIRST (matches matrix display order)
                // For theory allocations, prefer 'both' or 'theory' type
                let matchedSub = null;
                if (allocType === 'lab') {
                    matchedSub = candidateSubjects.find(s => s.subject_type === 'both') ||
                                 candidateSubjects.find(s => s.subject_type === 'lab');
                } else if (allocType === 'theory') {
                    matchedSub = candidateSubjects.find(s => s.subject_type === 'theory') ||
                                 candidateSubjects.find(s => s.subject_type === 'both');
                } else {
                    matchedSub = candidateSubjects[0] || null;
                }

                if (!matchedSub) {
                    errors.push(`Row ${rowCount}: Subject '${subCode}' not found.`);
                    continue;
                }

                // Find Teacher - Multiple matching strategies
                let matchedTeacher = null;

                // Strategy 1: Employee ID (highest priority)
                if (eCode) {
                    matchedTeacher = teachersData.find(t => t.employee_code && t.employee_code.toString().trim().toLowerCase() === eCode.toString().trim().toLowerCase());
                }

                if (!matchedTeacher && tName) {
                    // Helper to strip titles and normalize
                    const stripTitle = (name) => (name || '').replace(/^(dr\.?\s*|mr\.?\s*|mrs\.?\s*|ms\.?\s*|prof\.?\s*)/i, '').trim();
                    const fuzzyNorm = (name) => (name || '').replace(/[\s.,()\-]/g, '').toLowerCase();

                    const inputStripped = stripTitle(tName);

                    // Strategy 2: Case-insensitive exact match
                    const tNameLower = tName.trim().toLowerCase();
                    matchedTeacher = teachersData.find(t => t.full_name && t.full_name.trim().toLowerCase() === tNameLower);

                    // Strategy 3: Fuzzy match (remove all spaces, dots, special chars)
                    if (!matchedTeacher) {
                        const normInput = fuzzyNorm(tName);
                        matchedTeacher = teachersData.find(t => fuzzyNorm(t.full_name) === normInput);
                    }

                    // Strategy 4: Strip title prefix, then exact match
                    if (!matchedTeacher) {
                        const strippedLower = inputStripped.toLowerCase();
                        matchedTeacher = teachersData.find(t => {
                            const dbStripped = stripTitle(t.full_name).toLowerCase();
                            return dbStripped === strippedLower;
                        });
                    }

                    // Strategy 5: Strip title prefix, then fuzzy match (handles "Dr.Prabhat" vs "Prabhat", middle dots, etc.)
                    if (!matchedTeacher) {
                        const normStrippedInput = fuzzyNorm(inputStripped);
                        matchedTeacher = teachersData.find(t => {
                            const dbNormStripped = fuzzyNorm(stripTitle(t.full_name));
                            return dbNormStripped === normStrippedInput && normStrippedInput.length > 3;
                        });
                    }
                }

                if (!matchedTeacher) {
                    errors.push(`Row ${rowCount}: Teacher '${tName || ''} (${eCode || ''})' not found.`);
                    continue;
                }

                // Upsert allocation
                const [existing] = await db.query(
                    'SELECT id FROM section_subjects WHERE section_id = ? AND subject_id = ? AND allocation_type = ?',
                    [matchedSec.section_id, matchedSub.id, allocType]
                );

                if (existing.length > 0) {
                    await db.query('UPDATE section_subjects SET teacher_id = ? WHERE id = ?', [matchedTeacher.id, existing[0].id]);
                } else {
                    await db.query(
                        'INSERT INTO section_subjects (section_id, subject_id, teacher_id, allocation_type) VALUES (?, ?, ?, ?)',
                        [matchedSec.section_id, matchedSub.id, matchedTeacher.id, allocType]
                    );
                }
                successCount++;
            } catch (e) {
                errors.push(`Row ${rowCount}: Database error while processing.`);
            }
        }
        
        // Cleanup temp file
        fs.unlink(req.file.path, () => {});

        const summary = [
            `✅ ${successCount} subjects assigned successfully`,
            skippedCount > 0 ? `⏭️ ${skippedCount} rows skipped (Online/IBM/placeholder teachers)` : null,
            errors.length > 0 ? `❌ ${errors.length} rows failed (teacher not found or other issues)` : null
        ].filter(Boolean).join('\n');

        res.json({
            success: true,
            message: summary,
            successCount,
            skippedCount,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        if (req.file) fs.unlink(req.file.path, () => {});
        next(error);
    }
};

// @route   DELETE /api/allocations/clear/all
export const clearAllocations = async (req, res, next) => {
    try {
        let { session_id, department_id, class_id } = req.query;
        if (req.departmentId) department_id = req.departmentId;

        if (!session_id || !department_id) {
            return res.status(400).json({ success: false, message: 'Session ID and Department ID are required to clear allocations' });
        }

        let query = `
            DELETE ss FROM section_subjects ss
            JOIN sections sec ON ss.section_id = sec.id
            JOIN classes c ON sec.class_id = c.id
            WHERE c.session_id = ? AND c.department_id = ?
        `;
        const params = [session_id, department_id];

        if (class_id && class_id !== 'all' && class_id !== 'all_detailed') {
            query += ' AND c.id = ?';
            params.push(class_id);
        }

        const [result] = await db.query(query, params);
        
        res.json({ success: true, message: `Cleared ${result.affectedRows} allocations successfully.` });
    } catch (error) {
        next(error);
    }
};
