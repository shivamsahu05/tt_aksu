import db from '../config/db.js';

async function fixMergedClasses() {
    try {
        const [sections] = await db.query('SELECT * FROM sections WHERE merge_group_id IS NOT NULL');
        const [section_subjects] = await db.query('SELECT ss.*, sub.short_code FROM section_subjects ss JOIN subjects sub ON ss.subject_id = sub.id');
        
        // Group sections by merge_group_id
        const mergeGroups = new Map();
        for (const sec of sections) {
            if (!mergeGroups.has(sec.merge_group_id)) mergeGroups.set(sec.merge_group_id, []);
            mergeGroups.get(sec.merge_group_id).push(sec);
        }

        let fixCount = 0;

        for (const [groupId, groupSections] of mergeGroups.entries()) {
            if (groupSections.length < 2) continue;
            
            const firstSec = groupSections[0];
            const remainingSecs = groupSections.slice(1);
            const firstSubjects = section_subjects.filter(ss => ss.section_id === firstSec.id);

            for (const targetSec of remainingSecs) {
                const targetSubjects = section_subjects.filter(ss => ss.section_id === targetSec.id);

                for (const mySub of firstSubjects) {
                    const targetSub = targetSubjects.find(ts => ts.subject_id === mySub.subject_id);
                    if (targetSub) {
                        // They share the same subject! Ensure the teacher is the same.
                        if (mySub.teacher_id !== targetSub.teacher_id) {
                            console.log(`Mismatch found in Merge Group ${groupId} (Sec ${firstSec.section_name} vs ${targetSec.section_name}) for Subject ${mySub.short_code}. Teachers: ${mySub.teacher_id} vs ${targetSub.teacher_id}`);
                            
                            // Let's decide who keeps the teacher. The one with a valid teacher, or the one whose teacher has lower load.
                            // For simplicity, we'll assign mySub's teacher to targetSub.
                            const correctTeacher = mySub.teacher_id || targetSub.teacher_id;
                            
                            if (correctTeacher) {
                                await db.query('UPDATE section_subjects SET teacher_id = ? WHERE id = ?', [correctTeacher, targetSub.id]);
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
        console.log(`Successfully fixed ${fixCount} mismatched teachers in merged classes.`);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

fixMergedClasses();
