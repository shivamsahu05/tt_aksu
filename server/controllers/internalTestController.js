import db from '../config/db.js';

export const getInternalTests = async (req, res) => {
    try {
        let { session_id } = req.query;

        // If no session_id is provided, try to find the active one
        if (!session_id) {
            const [activeSession] = await db.query('SELECT id FROM academic_sessions WHERE is_active = 1 LIMIT 1');
            if (activeSession.length > 0) {
                session_id = activeSession[0].id;
            }
        }
        let query = `
            SELECT i.*, d.name as department_name, r.room_number, r.room_type, b.name as block_name,
                   s.full_name as subject_name, s.subject_code,
                   t.short_name as invigilator_name
            FROM internal_tests i
            LEFT JOIN departments d ON i.department_id = d.id
            LEFT JOIN rooms r ON i.room_id = r.id
            LEFT JOIN buildings b ON r.building_id = b.id
            LEFT JOIN subjects s ON i.subject_id = s.id
            LEFT JOIN teachers t ON i.invigilator_id = t.id
            WHERE 1=1
        `;
        const params = [];

        if (session_id) {
            query += ` AND i.session_id = ?`;
            params.push(session_id);
        }

        query += ` ORDER BY i.test_date DESC, i.start_time DESC`;

        const [tests] = await db.query(query, params);

        // Map multiple invigilator names if invigilator_ids exists
        const [teachers] = await db.query('SELECT id, short_name FROM teachers');
        const teacherMap = {};
        teachers.forEach(t => teacherMap[t.id] = t.short_name);

        const [classes] = await db.query('SELECT id, semester, program_name FROM classes');
        const classMap = {};
        classes.forEach(c => classMap[c.id] = `${c.semester} ${c.program_name}`);

        const mappedTests = tests.map(test => {
            if (test.invigilator_ids) {
                const ids = test.invigilator_ids.split(',');
                const names = ids.map(id => teacherMap[id] || id);
                test.invigilator_name = names.join(', ');
            }
            if (test.class_ids) {
                const cIds = test.class_ids.split(',');
                const cNames = cIds.map(id => classMap[id] || id);
                test.class_name = cNames.join(', ');
            } else if (test.class_id) {
                test.class_name = classMap[test.class_id] || test.class_id;
            }
            // For sections, the frontend will resolve section_ids using its full sections list.
            return test;
        });

        res.json(mappedTests);
    } catch (error) {
        console.error('Error fetching internal tests:', error);
        res.status(500).json({ message: 'Server error fetching internal tests' });
    }
};

export const addInternalTest = async (req, res) => {
    try {
        const { department_id, session_id, room_id, room_ids, class_id, class_ids, section_ids, registered_students, subject_id, subject_ids, subject_timings, subject_part, invigilator_ids, test_name, test_type, ref_id, test_date, start_time, end_time } = req.body;
        
        const reqRooms = room_ids ? (Array.isArray(room_ids) ? room_ids : room_ids.split(',')) : (room_id ? [room_id.toString()] : []);
        
        if (reqRooms.length === 0 || !test_name || !test_date || !start_time || !end_time) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        // Check for overlap in any of the selected rooms on the same date
        const overlapQuery = `
            SELECT id, room_id, room_ids FROM internal_tests 
            WHERE test_date = ? 
            AND (
                (start_time <= ? AND end_time > ?) OR
                (start_time < ? AND end_time >= ?) OR
                (start_time >= ? AND end_time <= ?)
            )
        `;
        const [existingTests] = await db.query(overlapQuery, [
            test_date, 
            start_time, start_time, 
            end_time, end_time,
            start_time, end_time
        ]);

        const hasOverlap = existingTests.some(t => {
            const existingRooms = t.room_ids ? t.room_ids.split(',') : (t.room_id ? [t.room_id.toString()] : []);
            return existingRooms.some(r => reqRooms.includes(r.toString()));
        });


        if (hasOverlap) {
            return res.status(400).json({ message: 'One or more selected rooms are already booked for another test during this time.' });
        }

        // Check for same-class overlap
        const classOverlapQuery = `
            SELECT id, class_ids, class_id FROM internal_tests 
            WHERE test_date = ? 
            AND (
                (start_time <= ? AND end_time > ?) OR
                (start_time < ? AND end_time >= ?) OR
                (start_time >= ? AND end_time <= ?)
            )
        `;
        const [classExistingTests] = await db.query(classOverlapQuery, [
            test_date, 
            start_time, start_time, 
            end_time, end_time,
            start_time, end_time
        ]);
        
        const reqClassIdStr = class_id ? class_id.toString() : '';
        const hasClassOverlap = classExistingTests.some(t => {
            const existingClasses = t.class_ids ? t.class_ids.split(',') : (t.class_id ? [t.class_id.toString()] : []);
            return existingClasses.includes(reqClassIdStr);
        });

        if (hasClassOverlap) {
            return res.status(400).json({ message: 'This class already has a subject scheduled at this date and time.' });
        }


        const primaryRoomId = reqRooms[0];
        const roomIdsStr = reqRooms.join(',');
        const subjectIdsStr = subject_ids || (subject_id ? String(subject_id) : null);
        const subjectTimingsStr = subject_timings ? (typeof subject_timings === 'string' ? subject_timings : JSON.stringify(subject_timings)) : null;

        // Insert test
        const query = `
            INSERT INTO internal_tests (department_id, session_id, room_id, room_ids, class_id, class_ids, section_ids, registered_students, subject_id, subject_ids, subject_timings, subject_part, invigilator_ids, test_name, test_type, ref_id, test_date, start_time, end_time)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const [result] = await db.query(query, [department_id || null, session_id || null, primaryRoomId, roomIdsStr, class_id || null, class_ids || class_id || null, section_ids || null, registered_students || null, subject_id || null, subjectIdsStr, subjectTimingsStr, subject_part || null, invigilator_ids || null, test_name, test_type || 'Class Test', ref_id || null, test_date, start_time, end_time]);

        res.status(201).json({ id: result.insertId, message: 'Internal test scheduled successfully' });
    } catch (error) {
        console.error('Error scheduling internal test:', error);
        res.status(500).json({ message: 'Server error scheduling internal test' });
    }
};

export const updateInternalTest = async (req, res) => {
    try {
        const { id } = req.params;
        const { department_id, session_id, room_id, room_ids, class_id, class_ids, section_ids, registered_students, subject_id, subject_ids, subject_timings, subject_part, invigilator_ids, test_name, test_type, ref_id, test_date, start_time, end_time } = req.body;
        
        const reqRooms = room_ids ? (Array.isArray(room_ids) ? room_ids : room_ids.split(',')) : (room_id ? [room_id.toString()] : []);
        
        if (reqRooms.length === 0 || !test_name || !test_date || !start_time || !end_time) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        // Check for overlap in any of the selected rooms on the same date (excluding this test)
        const overlapQuery = `
            SELECT id, room_id, room_ids FROM internal_tests 
            WHERE test_date = ? AND id != ?
            AND (
                (start_time <= ? AND end_time > ?) OR
                (start_time < ? AND end_time >= ?) OR
                (start_time >= ? AND end_time <= ?)
            )
        `;
        const [existingTests] = await db.query(overlapQuery, [
            test_date, id,
            start_time, start_time, 
            end_time, end_time,
            start_time, end_time
        ]);

        const hasOverlap = existingTests.some(t => {
            const existingRooms = t.room_ids ? t.room_ids.split(',') : (t.room_id ? [t.room_id.toString()] : []);
            return existingRooms.some(r => reqRooms.includes(r.toString()));
        });


        if (hasOverlap) {
            return res.status(400).json({ message: 'One or more selected rooms are already booked for another test during this time.' });
        }

        // Check for same-class overlap
        const classOverlapQuery = `
            SELECT id, class_ids, class_id FROM internal_tests 
            WHERE test_date = ? 
            AND (
                (start_time <= ? AND end_time > ?) OR
                (start_time < ? AND end_time >= ?) OR
                (start_time >= ? AND end_time <= ?)
            )
        `;
        const [classExistingTests] = await db.query(classOverlapQuery, [
            test_date, 
            start_time, start_time, 
            end_time, end_time,
            start_time, end_time
        ]);
        
        const reqClassIdStr = class_id ? class_id.toString() : '';
        const hasClassOverlap = classExistingTests.some(t => {
            const existingClasses = t.class_ids ? t.class_ids.split(',') : (t.class_id ? [t.class_id.toString()] : []);
            return existingClasses.includes(reqClassIdStr);
        });

        if (hasClassOverlap) {
            return res.status(400).json({ message: 'This class already has a subject scheduled at this date and time.' });
        }


        const primaryRoomId = reqRooms[0];
        const roomIdsStr = reqRooms.join(',');
        const subjectIdsStr = subject_ids || (subject_id ? String(subject_id) : null);
        const subjectTimingsStr = subject_timings ? (typeof subject_timings === 'string' ? subject_timings : JSON.stringify(subject_timings)) : null;

        // Update test
        const query = `
            UPDATE internal_tests 
            SET department_id = ?, session_id = ?, room_id = ?, room_ids = ?, class_id = ?, class_ids = ?, section_ids = ?, registered_students = ?, subject_id = ?, subject_ids = ?, subject_timings = ?, subject_part = ?, invigilator_ids = ?, test_name = ?, test_type = ?, ref_id = ?, test_date = ?, start_time = ?, end_time = ?
            WHERE id = ?
        `;
        await db.query(query, [department_id || null, session_id || null, primaryRoomId, roomIdsStr, class_id || null, class_ids || class_id || null, section_ids || null, registered_students || null, subject_id || null, subjectIdsStr, subjectTimingsStr, subject_part || null, invigilator_ids || null, test_name, test_type || 'Class Test', ref_id || null, test_date, start_time, end_time, id]);

        res.json({ message: 'Internal test updated successfully' });
    } catch (error) {
        console.error('Error updating internal test:', error);
        res.status(500).json({ message: 'Server error updating internal test' });
    }
};

export const deleteInternalTest = async (req, res) => {
    try {
        const { id } = req.params;
        await db.query('DELETE FROM internal_tests WHERE id = ?', [id]);
        res.json({ message: 'Internal test deleted successfully' });
    } catch (error) {
        console.error('Error deleting internal test:', error);
        res.status(500).json({ message: 'Server error deleting internal test' });
    }
};

export const getAvailableInvigilators = async (req, res) => {
    try {
        const { date, start_time, end_time, department_id, session_id, class_id, subject_id } = req.query;
        if (!date || !start_time || !end_time) {
            return res.status(400).json({ message: 'date, start_time, and end_time are required.' });
        }

        // Fetch allocated teachers for this subject/class
        let allocatedTeacherIds = new Set();
        if (class_id && subject_id) {
            // Find section_subjects mapping for this class and subject
            const [allocations] = await db.query(`
                SELECT ss.teacher_id 
                FROM section_subjects ss
                JOIN sections s ON ss.section_id = s.id
                WHERE s.class_id = ? AND ss.subject_id = ?
            `, [class_id, subject_id]);
            allocations.forEach(a => allocatedTeacherIds.add(a.teacher_id));
        }

        // Parse date to find the day of the week
        const d = new Date(date);
        const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayName = daysOfWeek[d.getDay()];

        const [dayRows] = await db.query('SELECT id FROM days WHERE name = ?', [dayName]);
        const dayId = dayRows.length > 0 ? dayRows[0].id : null;

        let activeTimetableCondition = '';
        if (dayId) {
            // Find overlapping time slots
            const [slots] = await db.query(`
                SELECT id FROM time_slots 
                WHERE (start_time <= ? AND end_time > ?) OR
                      (start_time < ? AND end_time >= ?) OR
                      (start_time >= ? AND end_time <= ?)
            `, [start_time, start_time, end_time, end_time, start_time, end_time]);
            
            const slotIds = slots.map(s => s.id);
            if (slotIds.length > 0) {
                activeTimetableCondition = `
                    t.id NOT IN (
                        SELECT teacher_id FROM timetable 
                        WHERE day_id = ${dayId} 
                        AND time_slot_id IN (${slotIds.join(',')}) 
                        AND status = 'active'
                        AND teacher_id IS NOT NULL
                    ) AND
                `;
            }
        }

        // Also if department_id is sent, we can filter, but wait, if it's sent we might want teachers from that dept. 
        // But let's leave it as returning all active free teachers, filtered on frontend, or filter here.
        let deptCondition = department_id ? `t.department_id = ${db.escape(department_id)} AND` : '';

        const query = `
            SELECT t.id, t.full_name, t.short_name, t.designation, t.department_id, d.short_code as department
            FROM teachers t
            LEFT JOIN departments d ON t.department_id = d.id
            WHERE t.is_active = 1 AND
                  ${activeTimetableCondition}
                  t.id NOT IN (
                      SELECT t2.id 
                      FROM teachers t2
                      JOIN internal_tests i ON FIND_IN_SET(t2.id, i.invigilator_ids) OR t2.id = i.invigilator_id
                      WHERE i.test_date = ? 
                      AND (
                          (i.start_time <= ? AND i.end_time > ?) OR
                          (i.start_time < ? AND i.end_time >= ?) OR
                          (i.start_time >= ? AND i.end_time <= ?)
                      )
                  )
            ORDER BY t.full_name ASC
        `;

        const [availableTeachers] = await db.query(query, [date, start_time, start_time, end_time, end_time, start_time, end_time]);
        
        // Add is_allocated flag
        const formattedTeachers = availableTeachers.map(t => ({
            ...t,
            is_allocated: allocatedTeacherIds.has(t.id)
        }));

        res.status(200).json(formattedTeachers);
    } catch (error) {
        console.error('Error in getAvailableInvigilators:', error);
        res.status(500).json({ message: 'Server error fetching available invigilators.' });
    }
};
