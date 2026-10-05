import db from '../config/db.js';
import ConflictEngine from './ConflictEngine.js';
import { GreedyHeuristicStrategy } from './SchedulingStrategy.js';
import { getTimeSlotsForDepartment } from '../utils/timeSlotHelper.js';

class TimetableEngine {
    constructor() {
        this.db = db;
    }

    async loadContext(sessionId, options = {}) {
        const context = {
            settings: {},
            days: [],
            timeSlots: [],
            teachers: new Map(),
            rooms: new Map(),
            sections: new Map(),
            subjects: new Map(),
            allocations: new Map(),
            allocationsList: [],
            timetable: [], // Active timetable entries
            teacherPreferences: new Map(), // teacher_id -> [preferences]
            libraryAllotments: [] // library allotments: { class_ids, days, start_time, end_time }
        };

        // 1. Settings
        const [settingsRows] = await this.db.query('SELECT setting_key, setting_value FROM settings');
        settingsRows.forEach(row => context.settings[row.setting_key] = row.setting_value);

        // Teacher Preferences
        const [preferences] = await this.db.query('SELECT * FROM teacher_preferences');
        preferences.forEach(p => {
            if (!context.teacherPreferences.has(p.teacher_id)) {
                context.teacherPreferences.set(p.teacher_id, []);
            }
            context.teacherPreferences.get(p.teacher_id).push(p);
        });

        // 2. Days & Slots (TimeSlots will be department-aware later in the strategy, but we can load global default or all)
        const [days] = await this.db.query('SELECT * FROM days ORDER BY day_order ASC');
        context.days = days;

        let deptIdForSlots = null;
        if (options.scope === 'department' && options.targetId) {
            deptIdForSlots = options.targetId;
        } else if (options.scope === 'class' && options.targetId) {
            const [cls] = await this.db.query('SELECT department_id FROM classes WHERE id = ?', [options.targetId]);
            if (cls.length > 0) deptIdForSlots = cls[0].department_id;
        }

        const slots = await getTimeSlotsForDepartment(deptIdForSlots, false);
        context.timeSlots = slots;

        // 3. Teachers
        const [teachers] = await this.db.query('SELECT * FROM teachers WHERE is_active = 1');
        teachers.forEach(t => context.teachers.set(t.id, t));

        // 4. Rooms
        const [rooms] = await this.db.query('SELECT * FROM rooms WHERE is_active = 1');
        rooms.forEach(r => context.rooms.set(r.id, r));

        // 5. Sections
        const [sections] = await this.db.query(`
            SELECT s.*, c.session_id, c.department_id, c.class_teacher_id, c.program_name, c.semester, c.building_id 
            FROM sections s 
            JOIN classes c ON s.class_id = c.id 
            WHERE c.session_id = ?
        `, [sessionId]);

        // 5a. Estimate missing student strengths based on program average (e.g. 1st year B.Tech taking average of 3rd/5th year B.Tech)
        const programStrengths = new Map();
        
        // First pass: gather valid strengths for each program
        sections.forEach(s => {
            if (s.program_name && s.student_strength > 0) {
                if (!programStrengths.has(s.program_name)) {
                    programStrengths.set(s.program_name, { total: 0, count: 0 });
                }
                const stats = programStrengths.get(s.program_name);
                stats.total += s.student_strength;
                stats.count += 1;
            }
        });

        // Second pass: apply estimated strengths to sections missing them
        sections.forEach(s => {
            if (!s.student_strength || s.student_strength <= 0) {
                if (s.program_name && programStrengths.has(s.program_name)) {
                    const stats = programStrengths.get(s.program_name);
                    s.student_strength = Math.round(stats.total / stats.count);
                    s.estimated_strength = true; // flag for reference
                } else {
                    // Ultimate fallback if no data exists for the program
                    s.student_strength = 60; 
                    s.estimated_strength = true;
                }
            }
            context.sections.set(s.id, s);
        });

        // 6. Subjects
        const [subjects] = await this.db.query('SELECT * FROM subjects WHERE is_active = 1');
        subjects.forEach(s => context.subjects.set(s.id, s));

        // 7. Allocations (Teacher -> Subject -> Section mappings)
        const [allocations] = await this.db.query(`
            SELECT ss.*, sub.subject_type, sub.l_credit as weekly_lectures, sub.p_credit as weekly_practicals, sub.full_name as subject_name,
                   sub.short_code as subject_code, sub.is_nptel, sub.nptel_mode, sub.is_elective, sec.section_name, c.session_id
            FROM section_subjects ss
            JOIN subjects sub ON ss.subject_id = sub.id
            JOIN sections sec ON ss.section_id = sec.id
            JOIN classes c ON sec.class_id = c.id
            WHERE c.session_id = ?
        `, [sessionId]);
        
        allocations.forEach(a => {
            context.allocations.set(`${a.section_id}_${a.subject_id}`, a);
            context.allocationsList.push(a);
        });

        // 8. Existing Timetable (to respect locked/published entries or for partial generation)
        const [existingTimetable] = await this.db.query(`
            SELECT * FROM timetable WHERE session_id = ? AND status = 'active'
        `, [sessionId]);
        context.timetable = existingTimetable;

        // 9. Library Allotments
        const [libraryAllotments] = await this.db.query(`
            SELECT la.class_ids, la.days, la.start_time, la.end_time
            FROM library_allotments la
            WHERE la.session_id = ?
        `, [sessionId]);
        context.libraryAllotments = libraryAllotments.map(la => ({
            classIds: (la.class_ids || '').split(',').map(Number).filter(Boolean),
            days: (la.days || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
            startTime: la.start_time,
            endTime: la.end_time
        }));

        return context;
    }

    /**
     * Generates a timetable for a given session.
     * @param {number} sessionId 
     * @param {Object} options - { overwrite: boolean, scope: 'full' | 'department' | 'class', targetId: number }
     */
    async generate(sessionId, options = { overwrite: true }) {
        const connection = await this.db.getConnection();
        try {
            await connection.beginTransaction();

            // Ensure "Remedial Class" subject exists globally
            const [remedialCheck] = await connection.query(`SELECT id FROM subjects WHERE short_code = 'REMEDIAL'`);
            let remedialSubjectId;
            const [dept] = await connection.query(`SELECT id FROM departments LIMIT 1`);
            const deptId = dept.length > 0 ? dept[0].id : 1;
            
            if (remedialCheck.length === 0) {
                const [insertRes] = await connection.query(`
                    INSERT INTO subjects (department_id, full_name, short_code, subject_type, total_credits, l_credit, t_credit, p_credit, is_active, is_elective)
                    VALUES (?, 'Remedial Class', 'REMEDIAL', 'theory', 0, 1, 0, 0, 1, 0)
                `, [deptId]);
                remedialSubjectId = insertRes.insertId;
            } else {
                remedialSubjectId = remedialCheck[0].id;
            }

            // Ensure a Dummy "Class Teacher" exists for sections without one
            await connection.query(`UPDATE teachers SET short_name = 'Class Teacher' WHERE short_name = 'CT' AND full_name = 'Class Teacher'`);
            const [dummyTeacherCheck] = await connection.query(`SELECT id FROM teachers WHERE full_name = 'Class Teacher' LIMIT 1`);
            let dummyTeacherId;
            if (dummyTeacherCheck.length === 0) {
                const [insertTRes] = await connection.query(`
                    INSERT INTO teachers (department_id, full_name, short_name, is_active)
                    VALUES (?, 'Class Teacher', 'Class Teacher', 1)
                `, [deptId]);
                dummyTeacherId = insertTRes.insertId;
            } else {
                dummyTeacherId = dummyTeacherCheck[0].id;
            }

            // Ensure "Library Period" subject exists (used as a gap-fill placeholder in rare edge cases)
            const [libraryCheck] = await connection.query(`SELECT id FROM subjects WHERE short_code = 'LIB'`);
            let librarySubjectId;
            if (libraryCheck.length === 0) {
                const [libInsert] = await connection.query(`
                    INSERT INTO subjects (department_id, full_name, short_code, subject_type, total_credits, l_credit, t_credit, p_credit, is_active, is_elective)
                    VALUES (?, 'Library Period', 'LIB', 'theory', 0, 0, 0, 0, 1, 0)
                `, [deptId]);
                librarySubjectId = libInsert.insertId;
            } else {
                librarySubjectId = libraryCheck[0].id;
            }

            // Ensure "Self Learning" subject exists (fills internal empty gaps)
            const [selfLearningCheck] = await connection.query(`SELECT id FROM subjects WHERE short_code = 'SL'`);
            let selfLearningSubjectId;
            if (selfLearningCheck.length === 0) {
                const [slInsert] = await connection.query(`
                    INSERT INTO subjects (department_id, full_name, short_code, subject_type, total_credits, l_credit, t_credit, p_credit, is_active, is_elective)
                    VALUES (?, 'Self Learning', 'SL', 'theory', 0, 0, 0, 0, 1, 0)
                `, [deptId]);
                selfLearningSubjectId = slInsert.insertId;
            } else {
                selfLearningSubjectId = selfLearningCheck[0].id;
            }

            const context = await this.loadContext(sessionId, options);
            context.remedialSubjectId = remedialSubjectId;
            context.dummyTeacherId = dummyTeacherId;
            context.librarySubjectId = librarySubjectId;
            context.selfLearningSubjectId = selfLearningSubjectId;

            // Filtering based on generation scope
            // For MVP, we'll assume full generation or specific class generation by filtering allocations
            let targetAllocations = context.allocationsList.filter(a => a.teacher_id !== null);
            if (options.scope === 'class' && options.targetId) {
                // Find sections for this class
                const targetSectionIds = Array.from(context.sections.values())
                    .filter(s => s.class_id === options.targetId)
                    .map(s => s.id);
                targetAllocations = targetAllocations.filter(a => targetSectionIds.includes(a.section_id));
                
                // Keep existing timetable entries for OTHER classes
                context.timetable = context.timetable.filter(t => !targetSectionIds.includes(t.section_id));
            } else if (options.scope === 'department' && options.targetId) {
                // Find sections for this department
                const targetSectionIds = Array.from(context.sections.values())
                    .filter(s => s.department_id === options.targetId)
                    .map(s => s.id);
                targetAllocations = targetAllocations.filter(a => targetSectionIds.includes(a.section_id));
                
                context.timetable = context.timetable.filter(t => !targetSectionIds.includes(t.section_id));
            } else if (options.overwrite && !options.resume) {
                context.timetable = []; // Clear current context if overwriting full session
            }

            // Create engine & strategy
            const conflictEngine = new ConflictEngine(context);
            const strategy = new GreedyHeuristicStrategy(conflictEngine);

            // Pass the target allocations to generate
            const generationContext = { ...context, allocations: targetAllocations, resume: options.resume, sessionId };
            const newEntries = strategy.generate(generationContext);

            // If overwrite, archive existing from DB instead of deleting
            if (options.overwrite && options.scope === 'full') {
                await connection.query("UPDATE timetable SET status = 'archived' WHERE session_id = ? AND status = 'active'", [sessionId]);
            } else if (options.overwrite && options.scope === 'class' && options.targetId) {
                const targetSectionIds = Array.from(context.sections.values())
                    .filter(s => s.class_id === options.targetId)
                    .map(s => s.id);
                if (targetSectionIds.length > 0) {
                    await connection.query("UPDATE timetable SET status = 'archived' WHERE section_id IN (?) AND status = 'active'", [targetSectionIds]);
                }
            } else if (options.overwrite && options.scope === 'department' && options.targetId) {
                const targetSectionIds = Array.from(context.sections.values())
                    .filter(s => s.department_id === options.targetId)
                    .map(s => s.id);
                if (targetSectionIds.length > 0) {
                    await connection.query("UPDATE timetable SET status = 'archived' WHERE section_id IN (?) AND status = 'active'", [targetSectionIds]);
                }
            }

            // Batch insert new entries
            if (newEntries.length > 0) {
                let batchId;
                if (typeof crypto !== 'undefined' && crypto.randomUUID) {
                    batchId = crypto.randomUUID();
                } else {
                    const { v4: uuidv4 } = await import('uuid');
                    batchId = uuidv4();
                }

                const values = newEntries.map(e => [
                    e.session_id, e.section_id, e.subject_id, e.teacher_id, 
                    e.room_id || null, e.is_online ? 1 : 0, e.day_id, e.time_slot_id, e.lab_group_id || null, 
                    options.userId || null, batchId
                ]);
                
                await connection.query(`
                    INSERT INTO timetable 
                    (session_id, section_id, subject_id, teacher_id, room_id, is_online, day_id, time_slot_id, lab_group_id, created_by, batch_id) 
                    VALUES ?
                `, [values]);
            }

            await connection.commit();
            return { success: true, count: newEntries.length };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Regenerates timetable for a specific single day respecting constraints and unavailable classes/teachers.
     */
    async generateDaily(sessionId, dayId, options = {}) {
        const connection = await this.db.getConnection();
        try {
            await connection.beginTransaction();

            const context = await this.loadContext(sessionId);
            
            // Load internal tests for the given date if targetDate is provided
            context.internalTests = [];
            if (options.targetDate) {
                const [tests] = await connection.query(`
                    SELECT room_id, start_time, end_time 
                    FROM internal_tests 
                    WHERE test_date = ?
                `, [options.targetDate]);
                context.internalTests = tests;
            }

            // Resolve Library and dummy teacher IDs (same as full generation)
            const [libCheckD] = await connection.query(`SELECT id FROM subjects WHERE short_code = 'LIB'`);
            if (libCheckD.length > 0) context.librarySubjectId = libCheckD[0].id;
            const [dummyCheckD] = await connection.query(`SELECT id FROM teachers WHERE full_name = 'Class Teacher' LIMIT 1`);
            if (dummyCheckD.length > 0) context.dummyTeacherId = dummyCheckD[0].id;

            let targetAllocations = context.allocationsList.filter(a => a.teacher_id !== null);

            if (options.scope === 'department' && options.targetId) {
                const targetSectionIds = Array.from(context.sections.values())
                    .filter(s => s.department_id === parseInt(options.targetId))
                    .map(s => s.id);
                targetAllocations = targetAllocations.filter(a => targetSectionIds.includes(a.section_id));
            }

            // Exclude unavailable classes if specified
            if (options.unavailable_classes && options.unavailable_classes.length > 0) {
                const unavClasses = options.unavailable_classes.map(Number);
                targetAllocations = targetAllocations.filter(a => {
                    const sec = context.sections.get(a.section_id);
                    return sec && !unavClasses.includes(sec.class_id) && !unavClasses.includes(sec.id);
                });
            }

            // Exclude unavailable teachers if specified
            if (options.unavailable_teachers && options.unavailable_teachers.length > 0) {
                const unavTeachers = options.unavailable_teachers.map(Number);
                targetAllocations = targetAllocations.filter(a => !unavTeachers.includes(a.teacher_id));
            }

            // Filter days to ONLY target dayId
            context.days = context.days.filter(d => d.id === parseInt(dayId));

            // Archive existing active slots for this specific day
            if (options.scope === 'department' && options.targetId) {
                const targetSectionIds = Array.from(context.sections.values())
                    .filter(s => s.department_id === parseInt(options.targetId))
                    .map(s => s.id);
                if (targetSectionIds.length > 0) {
                    await connection.query("UPDATE timetable SET status = 'archived' WHERE session_id = ? AND day_id = ? AND section_id IN (?) AND status = 'active'", [sessionId, dayId, targetSectionIds]);
                }
            } else {
                await connection.query("UPDATE timetable SET status = 'archived' WHERE session_id = ? AND day_id = ? AND status = 'active'", [sessionId, dayId]);
            }

            // Generate slots for this day
            const conflictEngine = new ConflictEngine(context);
            const strategy = new GreedyHeuristicStrategy(conflictEngine);
            const generationContext = { ...context, allocations: targetAllocations };
            const newEntries = strategy.generate(generationContext);

            if (newEntries.length > 0) {
                let batchId;
                if (typeof crypto !== 'undefined' && crypto.randomUUID) {
                    batchId = crypto.randomUUID();
                } else {
                    const { v4: uuidv4 } = await import('uuid');
                    batchId = uuidv4();
                }

                const values = newEntries.map(e => [
                    e.session_id, e.section_id, e.subject_id, e.teacher_id, 
                    e.room_id, e.day_id, e.time_slot_id, e.lab_group_id || null, 
                    options.userId || null, batchId
                ]);
                
                await connection.query(`
                    INSERT INTO timetable 
                    (session_id, section_id, subject_id, teacher_id, room_id, day_id, time_slot_id, lab_group_id, created_by, batch_id) 
                    VALUES ?
                `, [values]);
            }

            await connection.commit();
            return { success: true, count: newEntries.length };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Validates a manual move/swap.
     */
    async validateMove(sessionId, proposal, ignoreTimetableId) {
        const options = {};
        if (proposal.section_id) {
            options.scope = 'class';
            const [sec] = await this.db.query('SELECT class_id FROM sections WHERE id = ?', [proposal.section_id]);
            if (sec.length > 0) options.targetId = sec[0].class_id;
        }
        const context = await this.loadContext(sessionId, options);
        const conflictEngine = new ConflictEngine(context);
        return conflictEngine.validateAssignment(proposal, ignoreTimetableId);
    }
}

export default new TimetableEngine();
