import db from '../config/db.js';

async function fixData() {
    try {
        console.log('--- FIXING MERGED CLASSES TEACHERS ---');
        const [sections] = await db.query('SELECT * FROM sections WHERE merge_group_id IS NOT NULL');
        const [section_subjects] = await db.query('SELECT ss.*, sub.short_code FROM section_subjects ss JOIN subjects sub ON ss.subject_id = sub.id');
        
        const mergeGroups = new Map();
        for (const sec of sections) {
            if (!mergeGroups.has(sec.merge_group_id)) mergeGroups.set(sec.merge_group_id, []);
            mergeGroups.get(sec.merge_group_id).push(sec);
        }

        const cleanName = name => String(name).replace(/^(SEC|MDC|VAC|AEC|C|M|DSE|GE|CC|DSC)[-\s\d:]+/i, '').trim().toLowerCase();
        let fixCount = 0;

        for (const [groupId, groupSections] of mergeGroups.entries()) {
            if (groupSections.length < 2) continue;
            
            const firstSec = groupSections[0];
            const remainingSecs = groupSections.slice(1);
            const firstSubjects = section_subjects.filter(ss => ss.section_id === firstSec.id);

            for (const targetSec of remainingSecs) {
                const targetSubjects = section_subjects.filter(ss => ss.section_id === targetSec.id);

                for (const mySub of firstSubjects) {
                    const myClean = cleanName(mySub.short_code);
                    const targetSub = targetSubjects.find(ts => cleanName(ts.short_code) === myClean);
                    
                    if (targetSub) {
                        if (mySub.teacher_id !== targetSub.teacher_id) {
                            console.log(`Mismatch in Merge Group ${groupId} (${firstSec.section_name} vs ${targetSec.section_name}) for Subject '${myClean}'. Teachers: ${mySub.teacher_id} vs ${targetSub.teacher_id}`);
                            
                            const correctTeacher = mySub.teacher_id || targetSub.teacher_id;
                            if (correctTeacher) {
                                await db.query('UPDATE section_subjects SET teacher_id = ? WHERE id = ?', [correctTeacher, targetSub.id]);
                                await db.query('UPDATE section_subjects SET teacher_id = ? WHERE id = ?', [correctTeacher, mySub.id]);
                                targetSub.teacher_id = correctTeacher;
                                mySub.teacher_id = correctTeacher;
                                fixCount++;
                                console.log(` -> Fixed to Teacher ${correctTeacher}`);
                            }
                        }
                    }
                }
            }
        }
        console.log(`Fixed ${fixCount} mismatched teachers in merged classes.`);

        console.log('\n--- AGGRESSIVELY BALANCING TEACHER LOAD ---');
        const [teachers] = await db.query(`
            SELECT 
                t.id, t.full_name, t.short_name, t.department_id,
                COALESCE(SUM(sub.l_credit + sub.p_credit), 0) as current_load
            FROM teachers t
            LEFT JOIN section_subjects ss ON ss.teacher_id = t.id
            LEFT JOIN subjects sub ON ss.subject_id = sub.id
            LEFT JOIN sections sec ON ss.section_id = sec.id
            LEFT JOIN classes c ON sec.class_id = c.id AND c.session_id = 1
            WHERE t.is_active = 1
            GROUP BY t.id, t.department_id
        `);

        const teacherMap = new Map();
        teachers.forEach(t => teacherMap.set(t.id, { ...t, current_load: Number(t.current_load) }));

        // Consider "free" if load is <= 4 credits
        const freeTeachers = teachers.filter(t => Number(t.current_load) <= 4);
        console.log(`Found ${freeTeachers.length} under-utilized teachers (load <= 4).`);

        // Get subjects from heavily loaded teachers (> 18)
        const loadedTeachers = teachers.filter(t => Number(t.current_load) > 18).sort((a, b) => b.current_load - a.current_load);
        
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
            let freeTLoad = teacherMap.get(freeT.id).current_load;
            
            for (const loadedT of loadedTeachers) {
                if (loadedT.department_id !== freeT.department_id) continue;
                
                let loadedTLoad = teacherMap.get(loadedT.id).current_load;
                if (loadedTLoad <= 16) continue;

                let loadedTAssignments = assignments.filter(a => a.teacher_id === loadedT.id);
                loadedTAssignments.sort((a, b) => b.credits - a.credits);
                
                for (const assign of loadedTAssignments) {
                    if (freeTLoad >= 12) break; // Give free teacher up to 12 credits
                    if (loadedTLoad <= 16) break; // Keep loaded teacher at min 16
                    
                    let assignCredits = Number(assign.credits);
                    
                    console.log(`Reassigning ${assign.short_code} (${assignCredits}cr) from ${loadedT.short_name} (Load: ${loadedTLoad}) to ${freeT.short_name} (Load: ${freeTLoad})`);
                    await db.query('UPDATE section_subjects SET teacher_id = ? WHERE id = ?', [freeT.id, assign.id]);
                    
                    freeTLoad += assignCredits;
                    loadedTLoad -= assignCredits;
                    teacherMap.get(freeT.id).current_load = freeTLoad;
                    teacherMap.get(loadedT.id).current_load = loadedTLoad;
                    
                    assign.teacher_id = freeT.id;
                    reassignedCount++;
                }
            }
        }

        console.log(`Successfully assigned ${reassignedCount} subjects to under-utilized teachers.`);
        process.exit(0);

    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

fixData();
