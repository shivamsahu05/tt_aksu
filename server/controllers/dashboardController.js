import db from '../config/db.js';

export const getDashboardStats = async (req, res, next) => {
    try {
        const deptFilter = req.departmentId ? ' AND department_id = ' + db.escape(req.departmentId) : '';
        const deptId = req.departmentId ? ' AND id = ' + db.escape(req.departmentId) : '';
        
        // 1. Basic Stats
        let departmentName = null;
        if (req.departmentId) {
            const [deptResult] = await db.query('SELECT name FROM departments WHERE id = ?', [req.departmentId]);
            if (deptResult.length > 0) departmentName = deptResult[0].name;
        }

        const [deptCount] = await db.query('SELECT COUNT(*) as count FROM departments WHERE is_active = 1' + deptId);
        const [teacherCount] = await db.query('SELECT COUNT(*) as count FROM teachers WHERE is_active = 1' + deptFilter);
        const [subjectCount] = await db.query('SELECT COUNT(*) as count FROM subjects WHERE is_active = 1' + deptFilter);
        const [roomCount] = await db.query('SELECT COUNT(*) as count FROM rooms WHERE is_active = 1' + deptFilter);

        // 2. Active Session
        const [session] = await db.query('SELECT id, name FROM academic_sessions WHERE is_active = 1 LIMIT 1');
        const activeSession = session.length > 0 ? session[0] : null;

        // 3. Today & Tomorrow Leaves and Substitutions
        const [leavesOverview] = await db.query(`
            SELECT l.id, t.full_name as teacher, l.leave_start, l.leave_end, l.status
            FROM teacher_leaves l
            JOIN teachers t ON l.teacher_id = t.id
            WHERE l.status = 'approved' 
              AND l.leave_end >= CURRENT_DATE() 
              AND l.leave_start <= DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY)
            ${req.departmentId ? ' AND t.department_id = ' + db.escape(req.departmentId) : ''}
            ORDER BY l.leave_start ASC
            LIMIT 10
        `);

        const [absentClasses] = await db.query(`
            SELECT 
                MIN(t.id) as timetable_id,
                d.name as day,
                CASE 
                    WHEN d.name = DAYNAME(CURRENT_DATE()) THEN CURRENT_DATE()
                    ELSE DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY)
                END as target_date,
                CASE WHEN d.name = DAYNAME(CURRENT_DATE()) THEN 1 ELSE 0 END as is_today,
                abs_t.full_name as absent_teacher,
                abs_t.department_id,
                ts.start_time, ts.end_time, ts.slot_order,
                c.program_name, c.semester, sec.section_name,
                (SELECT COUNT(*) FROM sections s1 WHERE s1.class_id = c.id) as section_count,
                (SELECT COUNT(*) FROM sections s2 WHERE s2.class_id = c.id AND s2.id <= sec.id) as section_index,
                COALESCE(sub.short_code, sub.full_name) as subject,
                sub.subject_type,
                sub_t.full_name as substitute_teacher
            FROM teacher_leaves l
            JOIN teachers abs_t ON l.teacher_id = abs_t.id
            JOIN timetable t ON t.teacher_id = abs_t.id AND t.status = 'active'
            JOIN academic_sessions s_active ON t.session_id = s_active.id AND s_active.is_active = 1
            JOIN days d ON t.day_id = d.id
            JOIN time_slots ts ON t.time_slot_id = ts.id
            JOIN sections sec ON t.section_id = sec.id
            JOIN classes c ON sec.class_id = c.id
            JOIN subjects sub ON t.subject_id = sub.id
            LEFT JOIN timetable_replacements r ON r.timetable_id = t.id AND r.leave_id = l.id
            LEFT JOIN teachers sub_t ON r.substitute_teacher_id = sub_t.id
            WHERE l.status = 'approved'
              AND (
                  (d.name = DAYNAME(CURRENT_DATE()) AND l.leave_start <= CURRENT_DATE() AND l.leave_end >= CURRENT_DATE())
                  OR
                  (d.name = DAYNAME(DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY)) AND l.leave_start <= DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY) AND l.leave_end >= DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY))
              )
              ${req.departmentId ? ' AND abs_t.department_id = ' + db.escape(req.departmentId) : ''}
            GROUP BY abs_t.id, abs_t.department_id, d.id, ts.id, sec.id, sub.id, sub_t.full_name, c.program_name, c.semester, sec.section_name, c.id, sub.short_code, sub.full_name, sub.subject_type, ts.slot_order
            ORDER BY target_date ASC, ts.slot_order ASC
        `);

        // 3b. Engaged Substitutes (teachers assigned to cover absent teacher's classes today/tomorrow)
        const [engagedSubstitutes] = await db.query(`
            SELECT 
                sub_t.full_name as substitute_teacher,
                abs_t.full_name as absent_teacher,
                abs_t.department_id,
                d.name as day,
                CASE WHEN d.name = DAYNAME(CURRENT_DATE()) THEN 1 ELSE 0 END as is_today,
                ts.start_time, ts.end_time, ts.slot_order,
                c.program_name, sec.section_name, COALESCE(subj.short_code, subj.full_name) as subject,
                subj.subject_type,
                r.status,
                r.created_at
            FROM timetable_replacements r
            JOIN teacher_leaves l ON r.leave_id = l.id
            JOIN teachers abs_t ON l.teacher_id = abs_t.id
            JOIN teachers sub_t ON r.substitute_teacher_id = sub_t.id
            LEFT JOIN days d ON r.day_id = d.id
            LEFT JOIN time_slots ts ON r.time_slot_id = ts.id
            LEFT JOIN timetable t ON r.timetable_id = t.id AND t.status = 'active'
            LEFT JOIN sections sec ON t.section_id = sec.id
            LEFT JOIN classes c ON sec.class_id = c.id
            LEFT JOIN subjects subj ON t.subject_id = subj.id
            WHERE l.status = 'approved'
              AND (
                  (d.name = DAYNAME(CURRENT_DATE()) AND l.leave_start <= CURRENT_DATE() AND l.leave_end >= CURRENT_DATE())
                  OR
                  (d.name = DAYNAME(DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY)) AND l.leave_start <= DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY) AND l.leave_end >= DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY))
              )
              ${req.departmentId ? ' AND abs_t.department_id = ' + db.escape(req.departmentId) : ''}
            ORDER BY ts.slot_order ASC
        `);

        // 4. Detailed Timetable Stats
        let freeTeachersCount = 0;
        let occupiedRoomsCount = 0; // Means assigned theory rooms (home rooms)
        let totalTheoryRooms = 0;
        let totalLabRooms = 0;
        let teachersOnLeave = 0;
        
        const [theoryCount] = await db.query('SELECT COUNT(*) as count FROM rooms WHERE room_type != "lab" AND is_active = 1' + deptFilter);
        totalTheoryRooms = theoryCount[0].count;

        const [labCount] = await db.query('SELECT COUNT(*) as count FROM rooms WHERE room_type = "lab" AND is_active = 1' + deptFilter);
        totalLabRooms = labCount[0].count;

        // Occupied Theory Rooms = Count of distinct home_room_ids in sections
        // We join rooms to ensure we only count active rooms (and optionally filter by department)
        const [occR] = await db.query(`
            SELECT COUNT(DISTINCT s.home_room_id) as count 
            FROM sections s
            JOIN rooms r ON s.home_room_id = r.id
            WHERE r.is_active = 1
            ${req.departmentId ? ' AND r.department_id = ' + db.escape(req.departmentId) : ''}
        `);
        occupiedRoomsCount = occR[0].count;

        const [freeT] = await db.query(`
            SELECT id, full_name, short_name, employee_code, department_id FROM teachers WHERE is_active = 1 ${deptFilter} AND id NOT IN (
                SELECT DISTINCT teacher_id FROM section_subjects WHERE teacher_id IS NOT NULL
            )
        `);
        freeTeachersCount = freeT.length;
        const freeTeachersList = freeT;

        // Calculate Teachers on leave today
        const [leavesToday] = await db.query(`
            SELECT COUNT(DISTINCT l.teacher_id) as count
            FROM teacher_leaves l
            JOIN teachers t ON l.teacher_id = t.id
            WHERE CURRENT_DATE() >= DATE(l.leave_start) 
              AND CURRENT_DATE() <= DATE(l.leave_end)
              AND l.status = 'approved'
            ${req.departmentId ? ' AND t.department_id = ' + db.escape(req.departmentId) : ''}
        `);
        teachersOnLeave = leavesToday[0].count;

        // Calculate Delegated Users
        const [delegatedUsersRows] = await db.query(`
            SELECT COUNT(*) as count 
            FROM users 
            WHERE permissions IS NOT NULL 
              AND permissions != '[]' 
              AND permissions != '""' 
              AND permissions != ''
              AND is_active = 1
            ${req.departmentId ? ' AND department_id = ' + db.escape(req.departmentId) : ''}
        `);
        const delegatedUsersCount = delegatedUsersRows[0].count;

        // 5. Recent Leaves
        const [recentLeaves] = await db.query(`
            SELECT l.id, t.full_name as teacher, l.leave_start, l.leave_end, l.status
            FROM teacher_leaves l
            JOIN teachers t ON l.teacher_id = t.id
            ${req.departmentId ? 'WHERE t.department_id = ' + db.escape(req.departmentId) : ''}
            ORDER BY l.applied_at DESC
            LIMIT 5
        `);

        // 6. Recent Audit Logs (Timetable Changes + Logins)
        const [recentActivities] = await db.query(`
            SELECT a.action, a.table_name, a.created_at, u.username
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.id
            WHERE (a.table_name = 'timetable' OR (a.action IN ('login', 'logout') AND a.table_name = 'users'))
            ${req.user.role !== 'SUPER_ADMIN' ? ' AND a.user_id = ' + db.escape(req.user.id) : ''}
            ORDER BY a.created_at DESC
            LIMIT 5
        `);

        let allDepartments = [];
        if (!req.departmentId) {
            const [depts] = await db.query('SELECT id, name, short_code FROM departments WHERE is_active = 1');
            allDepartments = depts;
        }

        res.json({
            success: true,
            data: {
                departmentName,
                departmentsList: allDepartments,
                stats: {
                    departments: deptCount[0].count,
                    teachers: teacherCount[0].count,
                    subjects: subjectCount[0].count,
                    rooms: roomCount[0].count,
                    theory_rooms: totalTheoryRooms,
                    lab_rooms: totalLabRooms,
                    free_teachers: freeTeachersCount,
                    occupied_rooms: occupiedRoomsCount,
                    delegated_users: delegatedUsersCount,
                    teachers_on_leave: teachersOnLeave
                },
                activeSession,
                leavesOverview,
                absentClasses,
                engagedSubstitutes,
                recentLeaves,
                recentActivities,
                freeTeachersList
            }
        });
    } catch (error) {
        next(error);
    }
};
