import db from '../config/db.js';

async function balanceTeacherLoad() {
    try {
        console.log('Fetching teacher loads...');
        const [teachers] = await db.query(`
            SELECT 
                t.id, t.full_name, t.short_name, t.department_id, t.max_weekly_load,
                COALESCE(SUM(sub.l_credit + sub.p_credit), 0) as current_load
            FROM teachers t
            LEFT JOIN section_subjects ss ON ss.teacher_id = t.id
            LEFT JOIN subjects sub ON ss.subject_id = sub.id
            LEFT JOIN sections sec ON ss.section_id = sec.id
            LEFT JOIN classes c ON sec.class_id = c.id AND c.session_id = 1
            WHERE t.is_active = 1
            GROUP BY t.id, t.department_id, t.max_weekly_load
        `);

        // Create a map for quick lookup and update
        const teacherMap = new Map();
        teachers.forEach(t => teacherMap.set(t.id, { ...t, current_load: Number(t.current_load) }));

        // Identify overloaded teachers (load > 24)
        const overloaded = teachers.filter(t => Number(t.current_load) > 24);
        console.log(`Found ${overloaded.length} overloaded teachers.`);

        const [assignments] = await db.query(`
            SELECT ss.id, ss.teacher_id, ss.subject_id, t.department_id,
                   (sub.l_credit + sub.p_credit) as credits,
                   sub.subject_type, sub.short_code
            FROM section_subjects ss
            JOIN teachers t ON ss.teacher_id = t.id
            JOIN subjects sub ON ss.subject_id = sub.id
            JOIN sections sec ON ss.section_id = sec.id
            JOIN classes c ON sec.class_id = c.id
            WHERE c.session_id = 1 AND t.is_active = 1
        `);

        let reassignedCount = 0;

        for (const over of overloaded) {
            let currentLoad = teacherMap.get(over.id).current_load;
            let overAssignments = assignments.filter(a => a.teacher_id === over.id);

            // Sort assignments by credits descending to move larger blocks first
            overAssignments.sort((a, b) => b.credits - a.credits);
            
            console.log(`Teacher ${over.short_name} has ${overAssignments.length} assignments for Session 1.`);

            for (const assign of overAssignments) {
                if (currentLoad <= 22) break; // Leave them with a reasonable load (not 0)

                // Find a teacher in the SAME department who has room
                // Prefer teachers with load < 15, then < 20
                let bestCandidate = null;
                let assignCredits = Number(assign.credits);
                for (const [, candidate] of teacherMap.entries()) {
                    if (candidate.department_id === over.department_id && candidate.id !== over.id) {
                        if (candidate.current_load + assignCredits <= 24) {
                            // Perfect candidate
                            if (!bestCandidate || candidate.current_load < bestCandidate.current_load) {
                                bestCandidate = candidate;
                            }
                        }
                    }
                }

                if (bestCandidate) {
                    console.log(`Reassigning ${assign.short_code} (Credits: ${assign.credits}) from ${over.short_name} (Load: ${currentLoad}) to ${bestCandidate.short_name} (Load: ${bestCandidate.current_load})`);
                    
                    // Update database
                    await db.query('UPDATE section_subjects SET teacher_id = ? WHERE id = ?', [bestCandidate.id, assign.id]);
                    
                    // Update local state
                    currentLoad -= assignCredits;
                    teacherMap.get(over.id).current_load = currentLoad;
                    bestCandidate.current_load += assignCredits;
                    reassignedCount++;
                } else {
                    console.log(`No candidate found for ${assign.short_code} (Credits: ${assignCredits}) from ${over.short_name}`);
                }
            }
        }

        console.log(`Successfully reassigned ${reassignedCount} subjects.`);
        process.exit(0);

    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

balanceTeacherLoad();
