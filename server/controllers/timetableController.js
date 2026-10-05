import db from '../config/db.js';
import TimetableEngine from '../services/TimetableEngine.js';
import { getTimeSlotsForDepartment } from '../utils/timeSlotHelper.js';

// @route   POST /api/timetable/analyze-pre-generation
export const analyzePreGeneration = async (req, res, next) => {
    try {
        let { session_id, scope = 'full', target_id = null } = req.body;
        if (!session_id) return res.status(400).json({ success: false, message: 'Session ID is required.' });

        if (req.user.role === 'DEPARTMENT_ADMIN') {
            scope = 'department';
            target_id = req.user.department_id;
        }

        // 1. Slots calculation — use time_slots (not periods)
        let deptIdForSlots = null;
        if (scope === 'department' && target_id) {
            deptIdForSlots = target_id;
        } else if (scope === 'class' && target_id) {
            const [cls] = await db.query('SELECT department_id FROM classes WHERE id = ?', [target_id]);
            if (cls.length > 0) deptIdForSlots = cls[0].department_id;
        }
        const slots = await getTimeSlotsForDepartment(deptIdForSlots, true);
        const [days] = await db.query(`SELECT id, name, day_order FROM days WHERE is_active = 1 ORDER BY day_order ASC`);
        const totalPeriodsPerDay = slots.length;
        const totalActiveDays = days.length;

        // 2. Classes scoped by department/class filter
        let classQuery = `
            SELECT c.id, c.name, c.is_merged, c.merged_class_name 
            FROM classes c 
            LEFT JOIN departments d ON c.department_id = d.id 
            WHERE c.session_id = ? AND c.is_active = 1
        `;
        const classParams = [session_id];
        if (scope === 'department' && target_id) {
            classQuery += ' AND (c.department_id = ? OR COALESCE(c.building_id, d.building_id) IN (SELECT building_id FROM departments WHERE id = ?))';
            classParams.push(target_id, target_id);
        } else if (scope === 'class' && target_id) {
            classQuery += ' AND c.id = ?';
            classParams.push(target_id);
        }
        const [classes] = await db.query(classQuery, classParams);
        const classMap = new Map(classes.map(c => [c.id, c]));
        
        let validClassCount = 0;
        let mergedGroups = new Set();
        classes.forEach(c => {
             if (c.is_merged && c.merged_class_name) {
                 mergedGroups.add(c.merged_class_name);
             } else {
                 validClassCount += 1;
             }
        });
        validClassCount += mergedGroups.size;
        
        const totalTheoreticalSlots = validClassCount * totalPeriodsPerDay * totalActiveDays;

        // 3. Sections for these classes
        const classIds = classes.map(c => c.id);
        let sectionsList = [];
        if (classIds.length > 0) {
            const [secRows] = await db.query(`SELECT id, section_name, class_id FROM sections WHERE class_id IN (?)`, [classIds]);
            sectionsList = secRows;
        }
        const sectionMap = new Map(sectionsList.map(s => [s.id, s]));

        // 4. Allocations Analysis — scoped
        let allocQuery = `
            SELECT ss.section_id, ss.subject_id, ss.teacher_id, 
                   s.subject_type, s.is_nptel, s.l_credit, s.t_credit, s.p_credit, s.full_name as subject_name, s.short_code,
                   c.name as class_name, sec.section_name,
                   t.short_name as teacher_short_name, t.full_name as teacher_name
            FROM section_subjects ss
            JOIN subjects s ON ss.subject_id = s.id
            JOIN sections sec ON ss.section_id = sec.id
            JOIN classes c ON sec.class_id = c.id
            LEFT JOIN teachers t ON ss.teacher_id = t.id
            WHERE c.session_id = ? AND c.is_active = 1 AND s.is_active = 1
        `;
        const allocParams = [session_id];
        if (scope === 'department' && target_id) {
            allocQuery += ' AND c.department_id = ?';
            allocParams.push(target_id);
        } else if (scope === 'class' && target_id) {
            allocQuery += ' AND c.id = ?';
            allocParams.push(target_id);
        }
        const [allocations] = await db.query(allocQuery, allocParams);

        let theoryCredits = 0;
        let labCredits = 0;
        let nptelCredits = 0;
        let unassignedWarnings = [];
        let totalAssignedSlots = 0; // theory lectures + lab slots

        allocations.forEach(alloc => {
            if (alloc.is_nptel) {
                nptelCredits += 1;
                totalAssignedSlots += 1; // NPTEL = 1 slot/week
            } else {
                if (alloc.subject_type === 'theory' || alloc.subject_type === 'both') {
                    const lc = alloc.l_credit || 0;
                    theoryCredits += lc;
                    totalAssignedSlots += lc;
                }
                if (alloc.subject_type === 'lab' || alloc.subject_type === 'both') {
                    const pc = alloc.p_credit || 0;
                    labCredits += pc;
                    totalAssignedSlots += Math.ceil(pc / 2) * 2; // each lab = 2 consecutive slots
                }
            }

            if (!alloc.teacher_id) {
                if (!alloc.is_nptel) {
                    unassignedWarnings.push(`${alloc.subject_name} (${alloc.class_name} – ${alloc.section_name})`);
                }
            }
        });
        
        unassignedWarnings = [...new Set(unassignedWarnings)];

        // 5. Day-wise slot plan: for each day, how many classes are being scheduled and which teachers
        // We compute per-section average = totalAssignedSlots / validClassCount / totalActiveDays
        const slotsPerDayPerClass = totalActiveDays > 0 && validClassCount > 0
            ? (totalAssignedSlots / validClassCount / totalActiveDays).toFixed(1)
            : 0;

        // Build day plan summary — which sections are in play, how many allocs per section
        const sectionAllocCounts = {};
        allocations.forEach(a => {
            const key = a.section_id;
            if (!sectionAllocCounts[key]) sectionAllocCounts[key] = { sectionId: key, sectionName: a.section_name, className: a.class_name, subjectCount: 0, assignedCount: 0 };
            sectionAllocCounts[key].subjectCount++;
            if (a.teacher_id) sectionAllocCounts[key].assignedCount++;
        });

        const dayPlan = days.map(day => ({
            dayName: day.name,
            estimatedSlotsPerClass: Math.round(totalPeriodsPerDay * 0.8), // ~80% of periods filled typically
            totalSections: validClassCount
        }));

        const uniqueTeacherIds = [...new Set(allocations.filter(a => a.teacher_id).map(a => a.teacher_id))];
        const uniqueSubjectCount = [...new Set(allocations.map(a => a.subject_id))].length;

        res.json({
            success: true,
            data: {
                totalTheoreticalSlots,
                totalPeriodsPerDay,
                totalActiveDays,
                classCount: validClassCount,
                totalAssignedSlots,
                slotsPerDayPerClass,
                teacherCount: uniqueTeacherIds.length,
                subjectCount: uniqueSubjectCount,
                sectionCount: sectionsList.length,
                credits: {
                    theory: theoryCredits,
                    lab: labCredits,
                    nptel: nptelCredits
                },
                unassignedWarnings,
                dayPlan,
                slots: slots.map(s => ({ id: s.id, name: s.slot_name, start: s.start_time ? String(s.start_time).substring(0,5) : '', order: s.slot_order }))
            }
        });
    } catch (error) {
        next(error);
    }
};


// @route   POST /api/timetable/generate
export const generateTimetable = async (req, res, next) => {
    try {
        let { session_id, scope = 'full', target_id = null, overwrite = true, resume = false } = req.body;
        
        // Reset cancel flag
        global.cancelTimetableGeneration = global.cancelTimetableGeneration || {};
        global.cancelTimetableGeneration[session_id] = false;
        
        if (!session_id) {
            return res.status(400).json({ success: false, message: 'Session ID is required.' });
        }

        // Authorization check
        if (req.user.role === 'DEPARTMENT_ADMIN') {
            scope = 'department';
            target_id = req.user.department_id;
        } else if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        // Log generation start
        await db.query(`INSERT INTO audit_logs (user_id, action, table_name, new_value) VALUES (?, ?, ?, ?)`, 
            [req.user.id, 'generation_started', 'timetable', JSON.stringify({ session_id, scope, target_id })]);

        const result = await TimetableEngine.generate(session_id, {
            overwrite,
            resume,
            scope,
            targetId: target_id,
            userId: req.user.id
        });

        // Log generation complete
        await db.query(`INSERT INTO audit_logs (user_id, action, table_name, new_value) VALUES (?, ?, ?, ?)`, 
            [req.user.id, 'generation_completed', 'timetable', JSON.stringify({ session_id, count: result.count })]);

        res.json({ success: true, message: `Timetable generated successfully. ${result.count} slots assigned.`, count: result.count });
    } catch (error) {
        // Log generation failed
        try {
            await db.query(`INSERT INTO audit_logs (user_id, action, table_name, new_value) VALUES (?, ?, ?, ?)`, 
                [req.user?.id || null, 'generation_failed', 'timetable', JSON.stringify({ error: error.message })]);
        } catch (e) {}
        next(error);
    }
};

// @route   POST /api/timetable/regenerate-daily
export const regenerateDailyTimetable = async (req, res, next) => {
    try {
        const { session_id, date, department_id, unavailable_classes = [], unavailable_teachers = [] } = req.body;
        
        if (!session_id || !date) {
            return res.status(400).json({ success: false, message: 'Session ID and Date are required.' });
        }

        let target_id = department_id || null;
        let scope = target_id ? 'department' : 'full';

        if (req.user.role === 'DEPARTMENT_ADMIN') {
            scope = 'department';
            target_id = req.user.department_id;
        } else if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        const jsDate = new Date(date);
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayName = dayNames[jsDate.getDay()];

        const [dayResult] = await db.query('SELECT id FROM days WHERE name = ?', [dayName]);
        if (dayResult.length === 0) {
            return res.status(400).json({ success: false, message: `No active day found in database for ${dayName}` });
        }
        const day_id = dayResult[0].id;

        await db.query(`INSERT INTO audit_logs (user_id, action, table_name, new_value) VALUES (?, ?, ?, ?)`, 
            [req.user.id, 'daily_regeneration', 'timetable', JSON.stringify({ session_id, date, dayName, department_id: target_id, unavailable_classes, unavailable_teachers })]);

        const result = await TimetableEngine.generateDaily(session_id, day_id, {
            scope,
            targetId: target_id,
            unavailable_classes,
            unavailable_teachers,
            userId: req.user.id,
            targetDate: date
        });

        res.json({ success: true, message: `Today's timetable (${dayName}, ${date}) regenerated successfully. ${result.count} slots assigned.`, count: result.count });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/timetable/cancel
export const cancelGeneration = async (req, res, next) => {
    try {
        const { session_id } = req.body;
        if (!session_id) {
            return res.status(400).json({ success: false, message: 'Session ID is required.' });
        }
        
        global.cancelTimetableGeneration = global.cancelTimetableGeneration || {};
        global.cancelTimetableGeneration[session_id] = true;

        res.json({ success: true, message: 'Generation stop signal sent.' });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/timetable/daily-history
export const getDailyRegenerationHistory = async (req, res, next) => {
    try {
        const [rows] = await db.query(`
            SELECT a.id, a.user_id, a.action, a.table_name, a.new_value, a.created_at, u.username as generated_by_name 
            FROM audit_logs a 
            LEFT JOIN users u ON a.user_id = u.id 
            WHERE a.action = 'daily_regeneration' AND a.table_name = 'timetable' 
            ORDER BY a.created_at DESC 
            LIMIT 50
        `);
        res.json({ success: true, data: rows });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/timetable/validate
export const validateMove = async (req, res, next) => {
    try {
        const { session_id, proposal, ignore_timetable_id } = req.body;
        
        if (!session_id || !proposal) {
            return res.status(400).json({ success: false, message: 'Session ID and proposal are required.' });
        }

        const result = await TimetableEngine.validateMove(session_id, proposal, ignore_timetable_id);
        res.json({ success: true, valid: result.valid, reason: result.reason });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/timetable/history
// Fetch history of generated timetables
export const getTimetableHistory = async (req, res, next) => {
    try {
        let { session_id, department_id } = req.query;
        if (req.departmentId) department_id = req.departmentId;

        if (!session_id) {
            return res.status(400).json({ success: false, message: 'Session ID is required.' });
        }

        let query = `
            SELECT t.batch_id, MIN(t.created_at) as created_at, COUNT(t.id) as entry_count, t.status
            FROM timetable t
            JOIN sections sec ON t.section_id = sec.id
            JOIN classes c ON sec.class_id = c.id
            WHERE t.session_id = ? AND t.batch_id IS NOT NULL
        `;
        const params = [session_id];

        if (department_id) {
            query += ' AND c.department_id = ?';
            params.push(department_id);
        }

        query += ' GROUP BY t.batch_id, t.status ORDER BY created_at DESC';

        const [rows] = await db.query(query, params);
        res.json({ success: true, data: rows });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/timetable
// Fetch timetable grid based on filters
export const getTimetable = async (req, res, next) => {
    try {
        let { session_id, section_id, teacher_id, room_id, department_id, batch_id } = req.query;
        if (req.departmentId) department_id = req.departmentId;

        if (!session_id) {
            const [activeSession] = await db.query('SELECT id FROM academic_sessions WHERE is_active = 1 LIMIT 1');
            if (activeSession.length > 0) {
                session_id = activeSession[0].id;
            } else {
                return res.status(400).json({ success: false, message: 'Session ID is required or no active session found.' });
            }
        }

        let query = `
            SELECT t.*, 
                   sub.full_name as subject_name, sub.short_code as subject_code, sub.subject_type, sub.is_nptel, sub.total_credits, sub.p_credit, sub.l_credit,
                   teach.full_name as teacher_name, teach.short_name as teacher_short_name, teach.department_id,
                   r.room_number, r.room_type, r.building_id as room_building_id, b.name as room_building_name,
                   sec.section_name,
                   c.id as class_id, c.program_name, c.semester, c.department_id as class_department_id,
                   (SELECT COUNT(id) FROM sections WHERE class_id = c.id) as total_sections,
                   COALESCE(c.building_id, d.building_id) as class_building_id,
                   day_join.name as day_name, day_join.day_order,
                   s.start_time, s.end_time, s.slot_order, s.slot_type,
                   (
                       SELECT ss.allocation_type 
                       FROM section_subjects ss 
                       WHERE ss.section_id = t.section_id 
                         AND ss.subject_id = t.subject_id 
                         AND ss.teacher_id = t.teacher_id 
                       ORDER BY 
                         CASE 
                           WHEN t.lab_group_id IS NOT NULL AND ss.allocation_type = 'lab' THEN 1
                           WHEN t.lab_group_id IS NULL AND ss.allocation_type = 'theory' THEN 1
                           ELSE 2 
                         END
                       LIMIT 1
                   ) as allocation_type
            FROM timetable t
            JOIN subjects sub ON t.subject_id = sub.id
            LEFT JOIN teachers teach ON t.teacher_id = teach.id
            LEFT JOIN rooms r ON t.room_id = r.id
            LEFT JOIN buildings b ON r.building_id = b.id
            JOIN sections sec ON t.section_id = sec.id
            JOIN classes c ON sec.class_id = c.id
            LEFT JOIN departments d ON c.department_id = d.id
            JOIN days day_join ON t.day_id = day_join.id
            JOIN time_slots s ON t.time_slot_id = s.id
            WHERE t.session_id = ?
        `;
        const params = [session_id];

        if (batch_id) {
            query += ' AND t.batch_id = ?';
            params.push(batch_id);
        } else {
            query += " AND t.status = 'active'";
        }

        if (section_id) {
            query += ' AND t.section_id = ?';
            params.push(section_id);
        } else if (teacher_id) {
            query += ' AND t.teacher_id = ?';
            params.push(teacher_id);
        } else if (room_id) {
            query += ' AND t.room_id = ?';
            params.push(room_id);
        } else if (department_id) {
            // View timetable for entire department classes, including classes overridden to this department's building
            query += ' AND (c.department_id = ? OR COALESCE(c.building_id, d.building_id) IN (SELECT building_id FROM departments WHERE id = ?))';
            params.push(department_id, department_id);
        }

        query += ' ORDER BY day_join.day_order ASC, s.slot_order ASC';

        const [rows] = await db.query(query, params);

        // Fetch generation info for the session (only if active)
        let generationInfo = { current: null, previous: null };
        if (!batch_id) {
            const [auditRows] = await db.query(`
                SELECT created_at 
                FROM audit_logs 
                WHERE action = 'generation_completed' 
                  AND new_value LIKE ? 
                ORDER BY created_at DESC 
                LIMIT 2
            `, [`%"session_id":${session_id}%`]);

            if (auditRows.length > 0) {
                generationInfo.current = auditRows[0].created_at;
                if (auditRows.length > 1) {
                    generationInfo.previous = auditRows[1].created_at;
                }
            }
        }

        res.json({ success: true, data: rows, generationInfo });
    } catch (error) {
        next(error);
    }
};

// @route   PUT /api/timetable/:id
// Manual edit of a specific slot
export const updateTimetableSlot = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { subject_id, teacher_id, room_id, day_id, time_slot_id, force, is_hidden } = req.body;

        // Fetch existing
        const [existing] = await db.query('SELECT * FROM timetable WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Timetable entry not found.' });
        }

        const entry = existing[0];
        
        // Scope check
        if (req.departmentId) {
            const [deptCheck] = await db.query('SELECT c.department_id FROM sections sec JOIN classes c ON sec.class_id = c.id WHERE sec.id = ?', [entry.section_id]);
            if (deptCheck.length > 0 && deptCheck[0].department_id !== req.departmentId) {
                return res.status(403).json({ success: false, message: 'Forbidden' });
            }
        }
        const proposal = {
            session_id: entry.session_id,
            section_id: entry.section_id,
            subject_id: subject_id || entry.subject_id,
            teacher_id: teacher_id || entry.teacher_id,
            room_id: room_id || entry.room_id,
            day_id: day_id || entry.day_id,
            time_slot_id: time_slot_id || entry.time_slot_id,
            lab_group_id: entry.lab_group_id
        };

        let ignoreIds = [Number(id)];
        if (entry.lab_group_id) {
            const [peerRows] = await db.query('SELECT id FROM timetable WHERE lab_group_id = ?', [entry.lab_group_id]);
            ignoreIds = peerRows.map(r => r.id);
        } else {
            // Find theory merged peers (same slot, teacher, room)
            const [peerRows] = await db.query(
                'SELECT id FROM timetable WHERE day_id = ? AND time_slot_id = ? AND teacher_id = ? AND (room_id = ? OR (room_id IS NULL AND ? IS NULL)) AND status = "active"',
                [entry.day_id, entry.time_slot_id, entry.teacher_id, entry.room_id, entry.room_id]
            );
            ignoreIds = Array.from(new Set([...ignoreIds, ...peerRows.map(r => r.id)]));
        }

        // Set isShared flag in proposal so that if they move a block as a whole, it validates correctly
        proposal.isShared = ignoreIds.length > 1;

        // Validate move unless forced or no scheduling attributes changed
        const isMove = proposal.subject_id !== entry.subject_id || 
                       proposal.teacher_id !== entry.teacher_id || 
                       proposal.room_id !== entry.room_id || 
                       proposal.day_id !== entry.day_id || 
                       proposal.time_slot_id !== entry.time_slot_id;

        if (!force && isMove) {
            const validation = await TimetableEngine.validateMove(entry.session_id, proposal, ignoreIds);
            if (!validation.valid) {
                return res.status(409).json({ success: false, message: validation.reason, isConflict: true });
            }
        }

        // Check if moving a lab group to a new slot
        if (entry.lab_group_id && (proposal.day_id !== entry.day_id || proposal.time_slot_id !== entry.time_slot_id)) {
            const [labPeers] = await db.query('SELECT * FROM timetable WHERE lab_group_id = ? ORDER BY id ASC', [entry.lab_group_id]);
            const [secDept] = await db.query('SELECT c.department_id FROM sections s JOIN classes c ON s.class_id = c.id WHERE s.id = ?', [entry.section_id]);
            const allSlots = await getTimeSlotsForDepartment(secDept[0]?.department_id, true);
            const targetIndex = allSlots.findIndex(s => s.id === Number(proposal.time_slot_id));
            if (targetIndex !== -1 && targetIndex + 1 < allSlots.length && labPeers.length === 2) {
                const nextSlot = allSlots[targetIndex + 1];
                await db.query(`
                    UPDATE timetable 
                    SET subject_id = ?, teacher_id = ?, room_id = ?, day_id = ?, time_slot_id = ?
                    WHERE id = ?
                `, [proposal.subject_id, proposal.teacher_id, proposal.room_id, proposal.day_id, proposal.time_slot_id, labPeers[0].id]);
                await db.query(`
                    UPDATE timetable 
                    SET subject_id = ?, teacher_id = ?, room_id = ?, day_id = ?, time_slot_id = ?
                    WHERE id = ?
                `, [proposal.subject_id, proposal.teacher_id, proposal.room_id, proposal.day_id, nextSlot.id, labPeers[1].id]);

                await db.query(`INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)`, 
                    [req.user.id, 'manual_edit', 'timetable', id, JSON.stringify(entry), JSON.stringify(proposal)]);

                return res.json({ success: true, message: 'Lab session moved successfully.' });
            }
        }

        // Apply update
        await db.query(`
            UPDATE timetable 
            SET subject_id = ?, teacher_id = ?, room_id = ?, day_id = ?, time_slot_id = ?, is_hidden = ?
            WHERE id = ?
        `, [proposal.subject_id, proposal.teacher_id, proposal.room_id, proposal.day_id, proposal.time_slot_id, is_hidden !== undefined ? (is_hidden ? 1 : 0) : entry.is_hidden, id]);

        // Audit
        await db.query(`INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)`, 
            [req.user.id, 'manual_edit', 'timetable', id, JSON.stringify(entry), JSON.stringify(proposal)]);

        res.json({ success: true, message: 'Timetable updated successfully.' });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/timetable/:id/toggle-hidden
export const toggleHiddenSlot = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { is_hidden } = req.body;
        
        const [existing] = await db.query('SELECT * FROM timetable WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Timetable entry not found.' });
        }
        
        await db.query('UPDATE timetable SET is_hidden = ? WHERE id = ?', [is_hidden ? 1 : 0, id]);
        
        res.json({ success: true, message: 'Slot visibility updated successfully.' });
    } catch (error) {
        next(error);
    }
};

// @route   DELETE /api/timetable/:id
export const deleteTimetableSlot = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        const [existing] = await db.query('SELECT * FROM timetable WHERE id = ?', [id]);
        if (existing.length > 0) {
            // Scope check
            if (req.departmentId) {
                const [deptCheck] = await db.query('SELECT c.department_id FROM sections sec JOIN classes c ON sec.class_id = c.id WHERE sec.id = ?', [existing[0].section_id]);
                if (deptCheck.length > 0 && deptCheck[0].department_id !== req.departmentId) {
                    return res.status(403).json({ success: false, message: 'Forbidden' });
                }
            }
            
            await db.query('DELETE FROM timetable WHERE id = ?', [id]);
            await db.query(`INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value) VALUES (?, ?, ?, ?, ?)`, 
                [req.user.id, 'delete_slot', 'timetable', id, JSON.stringify(existing[0])]);
        }

        res.json({ success: true, message: 'Slot removed.' });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/timetable/swap
export const swapTimetableSlots = async (req, res, next) => {
    try {
        const { id1, id2 } = req.body; // if id2 is null, it's a move to an empty slot. We need source and target day/slot.

        // Complex swap requires fetching both, validating both simultaneously.
        // For now, returning standard message.
        res.status(501).json({ success: false, message: 'Swap API implemented in the next iteration.' });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/timetable/schema
// Returns days and timeslots
export const getTimetableSchema = async (req, res, next) => {
    try {
        const [days] = await db.query('SELECT * FROM days ORDER BY day_order ASC');
        const departmentId = req.query.department_id || (req.user.role === 'DEPARTMENT_ADMIN' ? req.user.department_id : null);
        const slots = await getTimeSlotsForDepartment(departmentId, false);
        res.json({ success: true, data: { days, slots } });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/timetable
// Manual create a specific slot
export const createTimetableSlot = async (req, res, next) => {
    try {
        const { session_id, section_id, subject_id, teacher_id, room_id, day_id, time_slot_id } = req.body;

        const proposal = { session_id, section_id, subject_id, teacher_id, room_id, day_id, time_slot_id };

        // Scope check
        if (req.departmentId) {
            const [deptCheck] = await db.query('SELECT c.department_id FROM sections sec JOIN classes c ON sec.class_id = c.id WHERE sec.id = ?', [section_id]);
            if (deptCheck.length > 0 && deptCheck[0].department_id !== req.departmentId) {
                return res.status(403).json({ success: false, message: 'Forbidden' });
            }
        }

        // Validate move
        const validation = await TimetableEngine.validateMove(session_id, proposal, null);
        if (!validation.valid) {
            return res.status(409).json({ success: false, message: validation.reason });
        }

        const [result] = await db.query(`
            INSERT INTO timetable (session_id, section_id, subject_id, teacher_id, room_id, day_id, time_slot_id, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [session_id, section_id, subject_id, teacher_id, room_id, day_id, time_slot_id, req.user.id]);

        await db.query(`INSERT INTO audit_logs (user_id, action, table_name, record_id, new_value) VALUES (?, ?, ?, ?, ?)`, 
            [req.user.id, 'manual_assign', 'timetable', result.insertId, JSON.stringify(proposal)]);

        res.json({ success: true, message: 'Slot assigned successfully.' });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/timetable/daily
// Fetch daily timetable for a specific date, including leaves and replacements
export const getDailyTimetable = async (req, res, next) => {
    try {
        let { date, session_id, department_id } = req.query;
        if (!date) {
            return res.status(400).json({ success: false, message: 'Date is required' });
        }
        if (!session_id) {
            const [activeSession] = await db.query('SELECT id FROM academic_sessions WHERE is_active = 1 LIMIT 1');
            if (activeSession.length > 0) {
                session_id = activeSession[0].id;
            } else {
                return res.status(400).json({ success: false, message: 'Session ID is required or no active session found.' });
            }
        }

        // Determine day of the week
        // JavaScript Date getDay(): 0=Sunday, 1=Monday, ..., 6=Saturday
        // Our 'days' table usually matches standard days. Let's get the name.
        const parts = date.split('-').map(Number);
        const jsDate = new Date(parts[0], parts[1] - 1, parts[2]);
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayName = dayNames[jsDate.getDay()];

        const [dayResult] = await db.query('SELECT id FROM days WHERE name = ? OR name LIKE ? LIMIT 1', [dayName, dayName + '%']);
        if (dayResult.length === 0) {
            return res.json({ success: true, data: [], message: `No active day found for ${dayName}` });
        }
        const day_id = dayResult[0].id;

        // Fetch timetable for that day and session
        let query = `
            SELECT t.id, t.session_id, t.section_id, t.subject_id, t.teacher_id, t.room_id, t.is_online, t.day_id, t.time_slot_id, t.lab_group_id,
                   c.program_name, c.semester, sec.section_name,
                   (SELECT COUNT(id) FROM sections WHERE class_id = c.id) as total_sections,
                   sub.full_name as subject_name, sub.short_code as subject_code, sub.subject_type, sub.p_credit, sub.l_credit,
                   tch.full_name as teacher_name, tch.short_name as teacher_short_name,
                   r.room_number, r.building_id as room_building_id, b.name as room_building_name, d.name as department_name, d.short_code as department_code,
                   COALESCE(c.building_id, d.building_id) as class_building_id,
                   s.start_time, s.end_time, s.slot_order,
                   (
                       SELECT ss.allocation_type 
                       FROM section_subjects ss 
                       WHERE ss.section_id = t.section_id 
                         AND ss.subject_id = t.subject_id 
                         AND ss.teacher_id = t.teacher_id 
                       ORDER BY 
                         CASE 
                           WHEN t.lab_group_id IS NOT NULL AND ss.allocation_type = 'lab' THEN 1
                           WHEN t.lab_group_id IS NULL AND ss.allocation_type = 'theory' THEN 1
                           ELSE 2 
                         END
                       LIMIT 1
                   ) as allocation_type
            FROM timetable t
            JOIN sections sec ON t.section_id = sec.id
            JOIN classes c ON sec.class_id = c.id
            JOIN subjects sub ON t.subject_id = sub.id
            LEFT JOIN teachers tch ON t.teacher_id = tch.id
            LEFT JOIN rooms r ON t.room_id = r.id
            LEFT JOIN buildings b ON r.building_id = b.id
            LEFT JOIN departments d ON c.department_id = d.id
            JOIN time_slots s ON t.time_slot_id = s.id
            WHERE t.session_id = ? AND t.day_id = ? AND t.status = 'active'
        `;
        const params = [session_id, day_id];

        if (req.departmentId) {
            query += ' AND (c.department_id = ? OR COALESCE(c.building_id, d.building_id) IN (SELECT building_id FROM departments WHERE id = ?))';
            params.push(req.departmentId, req.departmentId);
        } else if (department_id) {
            query += ' AND (c.department_id = ? OR COALESCE(c.building_id, d.building_id) IN (SELECT building_id FROM departments WHERE id = ?))';
            params.push(department_id, department_id);
        }

        query += ' ORDER BY s.slot_order ASC, c.program_name ASC, c.semester ASC, sec.section_name ASC';

        const [timetable] = await db.query(query, params);

        // Fetch all leaves (both approved and pending) for this date
        const [leaves] = await db.query(`
            SELECT id, teacher_id, leave_start, leave_end, reason, status
            FROM teacher_leaves
            WHERE LOWER(status) IN ('approved', 'pending') AND DATE(leave_start) <= ? AND DATE(leave_end) >= ?
        `, [date, date]);

        const leaveMap = {}; // teacher_id -> leave object
        leaves.forEach(l => leaveMap[l.teacher_id] = l);

        // Fetch all replacements for this day (status approved or pending)
        const [replacements] = await db.query(`
            SELECT r.id, r.leave_id, r.timetable_id, r.substitute_teacher_id, r.time_slot_id, r.day_id,
                   t.full_name as substitute_name,
                   COALESCE(l.teacher_id, tt.teacher_id) as absent_teacher_id
            FROM timetable_replacements r
            JOIN teachers t ON r.substitute_teacher_id = t.id
            LEFT JOIN teacher_leaves l ON r.leave_id = l.id
            LEFT JOIN timetable tt ON r.timetable_id = tt.id
            WHERE r.day_id = ? AND LOWER(r.status) IN ('approved', 'pending')
        `, [day_id]);

        // Merge Data
        const enrichedTimetable = timetable.map(slot => {
            let is_on_leave = false;
            let leave_id = null;
            let replacement = null;

            if (slot.teacher_id && leaveMap[slot.teacher_id]) {
                is_on_leave = true;
                leave_id = leaveMap[slot.teacher_id].id;
            }

            // Check if there is a replacement assigned for this timetable entry
            replacement = replacements.find(r => 
                (r.timetable_id && r.timetable_id === slot.id) ||
                (r.leave_id && leave_id && r.leave_id === leave_id && r.time_slot_id === slot.time_slot_id) ||
                (r.absent_teacher_id && r.absent_teacher_id === slot.teacher_id && r.time_slot_id === slot.time_slot_id)
            );

            if (replacement) {
                is_on_leave = true;
            }

            return {
                ...slot,
                is_on_leave,
                leave_id,
                replacement_id: replacement ? replacement.id : null,
                replacement_teacher_id: replacement ? replacement.substitute_teacher_id : null,
                replacement_teacher_name: replacement ? replacement.substitute_name : null,
            };
        });

        res.json({ success: true, data: enrichedTimetable, day_name: dayName });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/timetable/unassigned
export const getUnassignedWorkloads = async (req, res, next) => {
    try {
        const { session_id, department_id } = req.query;
        if (!session_id) return res.status(400).json({ success: false, message: 'session_id is required' });

        let query = `
            SELECT ss.*, 
                   s.full_name as subject_name, s.short_code as subject_code, s.subject_type, s.l_credit as weekly_lectures, s.p_credit as weekly_practicals,
                   t.full_name as teacher_name, t.designation,
                   sec.section_name,
                   c.program_name, c.semester,
                   (SELECT COUNT(*) FROM timetable tt 
                    LEFT JOIN rooms r ON tt.room_id = r.id
                    WHERE tt.session_id = ? AND tt.section_id = ss.section_id 
                    AND tt.subject_id = ss.subject_id AND tt.teacher_id = ss.teacher_id
                    AND (
                        (ss.is_online = 1) OR
                        (ss.allocation_type = 'theory' AND r.room_type = 'theory') OR
                        (ss.allocation_type = 'lab' AND r.room_type = 'lab')
                    )
                   ) as scheduled_count
            FROM section_subjects ss
            JOIN subjects s ON ss.subject_id = s.id
            JOIN teachers t ON ss.teacher_id = t.id
            JOIN sections sec ON ss.section_id = sec.id
            JOIN classes c ON sec.class_id = c.id
            WHERE c.session_id = ?
        `;
        const params = [session_id, session_id];
        
        const deptId = req.departmentId || department_id;
        if (deptId) {
            query += ' AND c.department_id = ?';
            params.push(deptId);
        }

        const [rows] = await db.query(query, params);

        const unassigned = rows.filter(r => {
            if (r.allocation_type === 'theory') return r.scheduled_count < r.weekly_lectures;
            if (r.allocation_type === 'lab') return r.scheduled_count < r.weekly_practicals;
            return false;
        });

        res.json({ success: true, data: unassigned });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/timetable/suggestions
import ConflictEngine from '../services/ConflictEngine.js';
export const getSlotSuggestions = async (req, res, next) => {
    try {
        const { session_id, section_id, subject_id, teacher_id, allocation_type, room_id, ignore_id } = req.query;
        if (!session_id || !section_id || !subject_id || !teacher_id || !allocation_type) {
            return res.status(400).json({ success: false, message: 'Missing parameters' });
        }

        const context = await TimetableEngine.loadContext(session_id);
        const conflictEngine = new ConflictEngine(context);

        let ignoreIds = null;
        if (ignore_id) {
            ignoreIds = Array.isArray(ignore_id) ? ignore_id.map(Number) : [Number(ignore_id)];
            const ignoredEntries = context.timetable.filter(t => ignoreIds.includes(t.id));
            ignoredEntries.forEach(ie => {
                if (ie.lab_group_id) {
                    context.timetable.filter(t => t.lab_group_id === ie.lab_group_id).forEach(t => {
                        if (!ignoreIds.includes(t.id)) ignoreIds.push(t.id);
                    });
                }
            });
        }

        const days = context.days;
        const slots = context.timeSlots.filter(s => s.slot_type !== 'break');
        
        let rooms = [];
        if (room_id) {
            rooms = [context.rooms.get(parseInt(room_id))].filter(Boolean);
        } else {
            const reqCap = context.sections.get(parseInt(section_id))?.capacity || 0;
            rooms = Array.from(context.rooms.values())
                .filter(r => (r.room_type === allocation_type || r.room_type === 'both') && r.capacity >= reqCap)
                .sort((a, b) => a.capacity - b.capacity);
        }

        const suggestions = [];

        if (allocation_type === 'theory') {
            for (const day of days) {
                for (const slot of slots) {
                    for (const room of rooms) {
                        const proposal = { session_id: parseInt(session_id), section_id: parseInt(section_id), subject_id: parseInt(subject_id), teacher_id: parseInt(teacher_id), room_id: room.id, day_id: day.id, time_slot_id: slot.id };
                        const val = conflictEngine.validateAssignment(proposal, ignoreIds);
                        if (val.valid) {
                            suggestions.push({ day, slot1: slot, room });
                            break; 
                        }
                    }
                }
            }
        } else {
            for (const day of days) {
                for (let s = 0; s < slots.length - 1; s++) {
                    const slot1 = slots[s];
                    const slot2 = slots[s+1];
                    if (slot2.slot_order - slot1.slot_order !== 1) continue;
                    
                    for (const room of rooms) {
                        const prop1 = { session_id: parseInt(session_id), section_id: parseInt(section_id), subject_id: parseInt(subject_id), teacher_id: parseInt(teacher_id), room_id: room.id, day_id: day.id, time_slot_id: slot1.id };
                        const val1 = conflictEngine.validateAssignment(prop1, ignoreIds);
                        if (val1.valid) {
                            // Temporarily add it to context to test consecutive slot
                            context.timetable.push({ ...prop1, id: 'temp_1', status: 'active' });
                            
                            const prop2 = { ...prop1, time_slot_id: slot2.id };
                            const val2 = conflictEngine.validateAssignment(prop2, ignoreIds);
                            
                            if (val2.valid) {
                                suggestions.push({ day, slot1, slot2, room });
                                context.timetable.pop(); // Remove temp
                                break;
                            }
                            context.timetable.pop(); // Remove temp
                        }
                    }
                }
            }
        }

        // Sort suggestions smartly:
        // 1. Teacher Preferred slots first
        // 2. Days with lower existing section workload first
        // 3. Morning/Afternoon preference based on section strength
        const teacherPrefs = context.teacherPreferences?.get(parseInt(teacher_id)) || [];
        const section = context.sections.get(parseInt(section_id));
        const isHighStrength = (section?.student_strength || 0) >= 40;

        suggestions.sort((a, b) => {
            const aPref = teacherPrefs.some(p => p.day_id === a.day.id && (p.time_slot_id === a.slot1.id || (a.slot2 && p.time_slot_id === a.slot2.id)) && p.preference_type === 'preferred');
            const bPref = teacherPrefs.some(p => p.day_id === b.day.id && (p.time_slot_id === b.slot1.id || (b.slot2 && p.time_slot_id === b.slot2.id)) && p.preference_type === 'preferred');
            if (aPref !== bPref) return aPref ? -1 : 1;

            // Day load balancer
            const aDayLoad = context.timetable.filter(t => t.section_id === parseInt(section_id) && t.day_id === a.day.id).length;
            const bDayLoad = context.timetable.filter(t => t.section_id === parseInt(section_id) && t.day_id === b.day.id).length;
            if (aDayLoad !== bDayLoad) return aDayLoad - bDayLoad;

            // Morning / Afternoon preference
            const aIsMorning = a.slot1.start_time < '12:30';
            const bIsMorning = b.slot1.start_time < '12:30';
            if (isHighStrength && aIsMorning !== bIsMorning) return aIsMorning ? -1 : 1;
            if (!isHighStrength && aIsMorning !== bIsMorning) return aIsMorning ? 1 : -1;

            return 0;
        });

        res.json({ success: true, data: suggestions });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/timetable/gap-analysis?session_id=X&department_id=Y
export const getGapAnalysis = async (req, res, next) => {
    try {
        const { session_id, department_id } = req.query;
        if (!session_id) return res.status(400).json({ success: false, message: 'session_id is required' });

        // Enforce department scope for DEPT_ADMIN
        let deptId = department_id || null;
        if (req.user.role === 'DEPARTMENT_ADMIN') deptId = req.user.department_id;

        // 1. Load time slots (non-break, ordered)
        const departmentId = req.query.department_id || (req.user.role === 'DEPARTMENT_ADMIN' ? req.user.department_id : null);
        const slots = await getTimeSlotsForDepartment(departmentId, false);
        const lectureSlots = slots.filter(s => s.slot_type !== 'break');
        const LUNCH_ORDER = slots.find(s => s.slot_type === 'break')?.slot_order ?? 5;

        // 2. Load days (no is_active column in days table)
        const [days] = await db.query(`SELECT id, name FROM days ORDER BY day_order ASC`);

        // 3. Load sections scoped by department
        let secQuery = `
            SELECT s.id, s.section_name, 
                   CONCAT(c.program_name, ' Sem', c.semester) AS class_name, c.id AS class_id,
                   d.name AS dept_name, d.id AS dept_id
            FROM sections s
            JOIN classes c ON s.class_id = c.id
            JOIN departments d ON c.department_id = d.id
            WHERE c.session_id = ? AND c.is_active = 1
        `;
        const secParams = [session_id];
        if (deptId) { secQuery += ' AND c.department_id = ?'; secParams.push(deptId); }
        secQuery += ' ORDER BY d.name, c.program_name, c.semester, s.section_name';
        const [sections] = await db.query(secQuery, secParams);

        // 4. Load timetable entries for these sections
        const sectionIds = sections.map(s => s.id);
        if (sectionIds.length === 0) {
            return res.json({ success: true, data: [], summary: { totalGaps: 0, sectionsWithGaps: 0, totalSections: 0 } });
        }

        const [ttEntries] = await db.query(`
            SELECT t.id, t.section_id, t.day_id, t.time_slot_id, t.teacher_id, t.room_id, t.subject_id,
                   sub.full_name AS subject_name, sub.short_code AS subject_code,
                   sub.is_elective, sub.subject_type,
                   tea.full_name AS teacher_name, tea.short_name AS teacher_short,
                   r.room_number AS room_name
            FROM timetable t
            LEFT JOIN subjects sub ON t.subject_id = sub.id
            LEFT JOIN teachers tea ON t.teacher_id = tea.id
            LEFT JOIN rooms r ON t.room_id = r.id
            WHERE t.section_id IN (?) AND t.status = 'active'
        `, [sectionIds]);

        // 5. All active entries in this session for teacher/room conflict detection
        const [allEntries] = await db.query(`
            SELECT t.section_id, t.day_id, t.time_slot_id, t.teacher_id, t.room_id,
                   sub.is_elective, sub.short_code AS subject_code
            FROM timetable t
            LEFT JOIN subjects sub ON t.subject_id = sub.id
            WHERE t.session_id = ? AND t.status = 'active'
        `, [session_id]);

        // 6. Load section_subjects (allocations) for teacher conflict checking
        const [allocations] = await db.query(`
            SELECT ss.section_id, ss.subject_id, ss.teacher_id,
                   sub.full_name AS subject_name, sub.short_code AS subject_code, sub.is_elective,
                   tea.full_name AS teacher_name
            FROM section_subjects ss
            JOIN subjects sub ON ss.subject_id = sub.id
            LEFT JOIN teachers tea ON ss.teacher_id = tea.id
            WHERE ss.section_id IN (?)
        `, [sectionIds]);

        // Build lookup maps
        const ttByTeacherDaySlot = {}; // teacher_id -> day_id -> Set<slot_id>
        const ttByRoomDaySlot = {};    // room_id -> day_id -> Set<slot_id>

        for (const e of allEntries) {
            if (e.teacher_id) {
                if (!ttByTeacherDaySlot[e.teacher_id]) ttByTeacherDaySlot[e.teacher_id] = {};
                if (!ttByTeacherDaySlot[e.teacher_id][e.day_id]) ttByTeacherDaySlot[e.teacher_id][e.day_id] = new Set();
                ttByTeacherDaySlot[e.teacher_id][e.day_id].add(e.time_slot_id);
            }
            if (e.room_id) {
                if (!ttByRoomDaySlot[e.room_id]) ttByRoomDaySlot[e.room_id] = {};
                if (!ttByRoomDaySlot[e.room_id][e.day_id]) ttByRoomDaySlot[e.room_id][e.day_id] = new Set();
                ttByRoomDaySlot[e.room_id][e.day_id].add(e.time_slot_id);
            }
        }

        const allocBySec = {};
        for (const a of allocations) {
            if (!allocBySec[a.section_id]) allocBySec[a.section_id] = [];
            allocBySec[a.section_id].push(a);
        }

        // Build per-section timetable: section_id -> day_id -> slot_id -> entry
        const ttBySecDaySlot = {};
        for (const e of ttEntries) {
            if (!ttBySecDaySlot[e.section_id]) ttBySecDaySlot[e.section_id] = {};
            if (!ttBySecDaySlot[e.section_id][e.day_id]) ttBySecDaySlot[e.section_id][e.day_id] = {};
            ttBySecDaySlot[e.section_id][e.day_id][e.time_slot_id] = e;
        }

        const results = [];
        let totalGaps = 0;

        for (const sec of sections) {
            const secGaps = [];
            const secAllocs = (allocBySec[sec.id] || []).filter(a => !a.is_elective);

            for (const day of days) {
                const daySlotMap = (ttBySecDaySlot[sec.id] || {})[day.id] || {};

                // Process the entire day as a single block to detect cross-lunch gaps
                const dayFilled = lectureSlots.filter(s => daySlotMap[s.id]);
                if (dayFilled.length < 2) continue;

                const minOrder = Math.min(...dayFilled.map(s => s.slot_order));
                const maxOrder = Math.max(...dayFilled.map(s => s.slot_order));

                for (const slot of lectureSlots) {
                    if (slot.slot_order <= minOrder || slot.slot_order >= maxOrder) continue;
                        if (daySlotMap[slot.id]) continue; // filled — no gap

                        // --- GAP FOUND — determine why ---
                        const reasonParts = [];

                        // Check if any teacher from this section's allocs is busy
                        const busyTeachers = [];
                        for (const alloc of secAllocs) {
                            if (alloc.teacher_id && ttByTeacherDaySlot[alloc.teacher_id]?.[day.id]?.has(slot.id)) {
                                busyTeachers.push(alloc.teacher_name || `Teacher #${alloc.teacher_id}`);
                            }
                        }
                        if (busyTeachers.length > 0) {
                            reasonParts.push(`Teacher busy: ${[...new Set(busyTeachers)].join(', ')}`);
                        }
                        
                        // Check room availability broadly
                        const roomsBusy = Object.values(ttByRoomDaySlot)
                            .filter(dayMap => dayMap[day.id]?.has(slot.id)).length;
                        const totalRooms = Object.keys(ttByRoomDaySlot).length;
                        const allRoomsOccupied = totalRooms > 0 && roomsBusy >= totalRooms;
                        
                        if (allRoomsOccupied && busyTeachers.length === 0) {
                            reasonParts.push(`All ${totalRooms} rooms occupied in this slot`);
                        }

                        if (secAllocs.length === 0) {
                            reasonParts.push('No theory/lab allocations found for this section');
                        }

                        if (reasonParts.length === 0) {
                            reasonParts.push('Scheduler skipped slot (score-based greedy chose better slots on other days)');
                        }

                        secGaps.push({
                            day: day.name,
                            dayId: day.id,
                            slot: `P${slot.slot_order}`,
                            slotTime: `${String(slot.start_time).substring(0,5)}–${String(slot.end_time).substring(0,5)}`,
                            slotId: slot.id,
                            reason: reasonParts.join(' | '),
                            reasonType: busyTeachers.length > 0 ? 'TEACHER_BUSY'
                                : allRoomsOccupied ? 'ROOM_OCCUPIED'
                                : secAllocs.length === 0 ? 'NO_ALLOCATION'
                                : 'SCHEDULER_SKIPPED'
                        });
                        totalGaps++;
                    }
            }
            if (secGaps.length > 0) {
                results.push({
                    sectionId: sec.id,
                    sectionName: sec.section_name,
                    className: sec.class_name,
                    deptName: sec.dept_name,
                    gapCount: secGaps.length,
                    gaps: secGaps,
                });
            }
        }

        results.sort((a, b) => b.gapCount - a.gapCount);

        res.json({
            success: true,
            data: results,
            summary: {
                totalGaps,
                sectionsWithGaps: results.length,
                totalSections: sections.length,
            }
        });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/timetable/activate/:batch_id
export const activateTimetableHistory = async (req, res, next) => {
    const connection = await db.getConnection();
    try {
        const { batch_id } = req.params;

        if (!batch_id) {
            return res.status(400).json({ success: false, message: 'Batch ID is required.' });
        }

        await connection.beginTransaction();

        // Get all sections associated with this batch
        const [sections] = await connection.query('SELECT DISTINCT section_id FROM timetable WHERE batch_id = ?', [batch_id]);
        if (sections.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Timetable batch not found.' });
        }
        
        const sectionIds = sections.map(s => s.section_id);

        // Archive currently active timetable for these sections
        await connection.query(`UPDATE timetable SET status = 'archived' WHERE section_id IN (?) AND status = 'active'`, [sectionIds]);
        
        // Activate the requested batch
        await connection.query(`UPDATE timetable SET status = 'active' WHERE batch_id = ?`, [batch_id]);

        await connection.query(`INSERT INTO audit_logs (user_id, action, table_name, new_value) VALUES (?, ?, ?, ?)`, 
            [req.user.id, 'timetable_activated', 'timetable', JSON.stringify({ batch_id })]);

        await connection.commit();
        res.json({ success: true, message: 'Timetable restored and activated successfully.' });
    } catch (error) {
        await connection.rollback();
        next(error);
    } finally {
        connection.release();
    }
};
