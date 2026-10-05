import db from '../config/db.js';

async function assignFreeTeachers() {
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

        const teacherMap = new Map();
        teachers.forEach(t => teacherMap.set(t.id, { ...t, current_load: Number(t.current_load) }));

        // The free teachers
        const freeTeachers = teachers.filter(t => Number(t.current_load) === 0);
        console.log(`Found ${freeTeachers.length} totally free teachers.`);

        // The loaded teachers (anyone > 15)
        const loadedTeachers = teachers.filter(t => Number(t.current_load) > 15).sort((a, b) => b.current_load - a.current_load);
        
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

        for (const freeT of freeTeachers) {
            // Find a loaded teacher in the same department to take load from
            let freeTLoad = teacherMap.get(freeT.id).current_load;
            
            for (const loadedT of loadedTeachers) {
                if (loadedT.department_id !== freeT.department_id) continue;
                
                let loadedTLoad = teacherMap.get(loadedT.id).current_load;
                if (loadedTLoad <= 15) continue; // Don't strip them completely

                let loadedTAssignments = assignments.filter(a => a.teacher_id === loadedT.id);
                loadedTAssignments.sort((a, b) => b.credits - a.credits); // try biggest first
                
                for (const assign of loadedTAssignments) {
                    if (freeTLoad >= 10) break; // Give the free teacher up to ~10 credits
                    if (loadedTLoad <= 15) break; // Don't strip loaded teacher below 15
                    
                    let assignCredits = Number(assign.credits);
                    
                    console.log(`Giving ${assign.short_code} (${assignCredits}cr) to FREE teacher ${freeT.short_name} from ${loadedT.short_name}`);
                    await db.query('UPDATE section_subjects SET teacher_id = ? WHERE id = ?', [freeT.id, assign.id]);
                    
                    freeTLoad += assignCredits;
                    loadedTLoad -= assignCredits;
                    teacherMap.get(freeT.id).current_load = freeTLoad;
                    teacherMap.get(loadedT.id).current_load = loadedTLoad;
                    
                    // Remove from assignments so we don't process it again
                    assign.teacher_id = freeT.id;
                    reassignedCount++;
                }
            }
        }

        console.log(`Successfully assigned ${reassignedCount} subjects to free teachers.`);
        process.exit(0);

    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

assignFreeTeachers();
