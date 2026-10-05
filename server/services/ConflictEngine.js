class ConflictEngine {
    constructor(context) {
        // Context contains all loaded data for the session being generated/edited
        // This avoids N+1 queries by relying on in-memory data structures.
        this.timetable = context.timetable || []; // Array of active slots
        this.teachers = context.teachers || new Map(); // Map of teacher_id -> Teacher object
        this.rooms = context.rooms || new Map(); // Map of room_id -> Room object
        this.sections = context.sections || new Map(); // Map of section_id -> Section object
        this.subjects = context.subjects || new Map(); // Map of subject_id -> Subject object
        this.allocations = context.allocations || new Map(); // Map of section_id_subject_id -> allocation details
        this.timeSlots = context.timeSlots || []; // Array of time slots
        this.settings = context.settings || {}; // Global settings
        this.teacherPreferences = context.teacherPreferences || new Map(); // Map of teacher_id -> [preferences]
        // dummyTeacherId: the placeholder 'Class Teacher' used only for FK constraint satisfaction.
        // This teacher is allowed to appear in any number of sections simultaneously.
        this.dummyTeacherId = context.dummyTeacherId || null;
        this.internalTests = context.internalTests || []; // List of internal tests for the target date
    }

    /**
     * Update the active timetable context with a new/modified entry
     */
    updateContext(newTimetable) {
        this.timetable = newTimetable;
    }

    /**
     * Validates a single proposed slot assignment against all rules.
     * @param {Object} proposal - { session_id, section_id, subject_id, teacher_id, room_id, day_id, time_slot_id, lab_group_id }
     * @param {number} ignoreTimetableId - ID to ignore when checking (useful for edits/swaps)
     * @returns {Object} { valid: boolean, reason: string | null }
     */
    validateAssignment(proposal, ignoreTimetableId = null) {
        const { session_id, section_id, subject_id, teacher_id, room_id, day_id, time_slot_id, lab_group_id } = proposal;

        // Filter active timetable entries that are not the one being edited
        let activeEntries;
        if (typeof ignoreTimetableId === 'object' && ignoreTimetableId !== null) {
            activeEntries = this.timetable.filter(t => t.status === 'active' && t !== ignoreTimetableId);
        } else {
            const ignoreIds = Array.isArray(ignoreTimetableId)
                ? ignoreTimetableId.map(Number)
                : (ignoreTimetableId !== null && ignoreTimetableId !== undefined ? [Number(ignoreTimetableId)] : []);
            activeEntries = this.timetable.filter(t => t.status === 'active' && !ignoreIds.includes(t.id));
        }

        // 1. Teacher Conflict (Double Booking)
        // Skip conflict check for the dummy 'Class Teacher' – it is a placeholder that can
        // appear in any number of sections simultaneously without a real scheduling conflict.
        const isDummyTeacher = this.dummyTeacherId && teacher_id === this.dummyTeacherId;
        if (!proposal.ignoreTeacherConflict && !isDummyTeacher && teacher_id !== null && teacher_id !== undefined) {
            const teacherClash = activeEntries.find(t => 
                t.teacher_id === teacher_id && 
                t.day_id === day_id && 
                t.time_slot_id === time_slot_id &&
                !(t.room_id === room_id && proposal.isShared) // Allowed only if it's explicitly a shared block
            );
            if (teacherClash) {
                const t = this.teachers.get(teacher_id);
                return { valid: false, reason: `Teacher ${t ? t.short_name : teacher_id} is already assigned at this time.` };
            }
        }

        // 2. Room Conflict
        const roomClash = activeEntries.find(t => 
            t.room_id === room_id && 
            t.day_id === day_id && 
            t.time_slot_id === time_slot_id &&
            !(t.teacher_id === teacher_id && proposal.isShared) // Allowed only if it's explicitly a shared block
        );
        if (roomClash) {
            const r = this.rooms.get(room_id);
            return { valid: false, reason: `Room ${r ? r.room_number : room_id} is already occupied at this time.` };
        }

        // 2.b Internal Test Conflict
        if (this.internalTests && this.internalTests.length > 0) {
            const timeSlot = this.timeSlots.find(ts => ts.id === time_slot_id);
            if (timeSlot) {
                const tsStart = timeSlot.start_time;
                const tsEnd = timeSlot.end_time;
                const testClash = this.internalTests.find(test => 
                    test.room_id === room_id &&
                    (
                        (test.start_time <= tsStart && test.end_time > tsStart) ||
                        (test.start_time < tsEnd && test.end_time >= tsEnd) ||
                        (test.start_time >= tsStart && test.end_time <= tsEnd)
                    )
                );
                if (testClash) {
                    const r = this.rooms.get(room_id);
                    return { valid: false, reason: `Room ${r ? r.room_number : room_id} is reserved for an Internal Test during this time.` };
                }
            }
        }

        // 3. Section Conflict
        const sectionClash = activeEntries.find(t => 
            t.section_id === section_id && 
            t.day_id === day_id && 
            t.time_slot_id === time_slot_id
        );
        if (sectionClash) {
            return { valid: false, reason: `This section already has a class scheduled at this time.` };
        }

        // 4. Room Capacity & Type
        const room = this.rooms.get(room_id);
        const section = this.sections.get(section_id);
        const subject = this.subjects.get(subject_id);

        if (proposal.strictCapacity && room && section && room.capacity < section.student_strength) {
            return { valid: false, reason: `Room ${room.room_number} capacity (${room.capacity}) is less than section strength (${section.student_strength}).` };
        }

        if (room && subject) {
            if (subject.subject_type === 'lab' && room.room_type !== 'lab') {
                return { valid: false, reason: `Subject requires a lab, but Room ${room.room_number} is a ${room.room_type}.` };
            }
        }

        // 5. Subject Allocation Validation
        const allocKey = `${section_id}_${subject_id}`;
        if (this.allocations.size > 0 && !proposal.isRemedial) { // If allocation checking is strictly enforced (manual edits usually enforce this)
            const alloc = this.allocations.get(allocKey);
            if (!alloc) {
                return { valid: false, reason: `Subject is not allocated to this section.` };
            }
            if (alloc.teacher_id !== teacher_id) {
                return { valid: false, reason: `Teacher mismatch. Allocated teacher differs from requested teacher.` };
            }
        }

        // 6. Teacher Availability (Constraints / Preferences)
        if (teacher_id && !proposal.ignoreTeacherConflict && this.teacherPreferences) {
            const prefs = this.teacherPreferences.get(teacher_id) || [];
            const isUnavailable = prefs.some(p => p.day_id === day_id && p.time_slot_id === time_slot_id && p.preference_type === 'unavailable');
            if (isUnavailable) {
                const t = this.teachers.get(teacher_id);
                return { valid: false, reason: `Teacher ${t ? t.short_name : teacher_id} has marked this slot as Unavailable in constraints.` };
            }
        }

        // 7. Teacher Workload Limits (skip for dummy teacher)
        const teacher = this.teachers.get(teacher_id);
        if (teacher && !isDummyTeacher && !proposal.ignoreTeacherConflict) {
            // Count daily load
            const dailyLoad = activeEntries.filter(t => t.teacher_id === teacher_id && t.day_id === day_id).length;
            if (dailyLoad >= teacher.max_daily_load) {
                return { valid: false, reason: `Teacher ${teacher.short_name} exceeds max daily load (${teacher.max_daily_load}).` };
            }

            // Count weekly load
            const weeklyLoad = activeEntries.filter(t => t.teacher_id === teacher_id).length;
            if (weeklyLoad >= teacher.max_weekly_load) {
                return { valid: false, reason: `Teacher ${teacher.short_name} exceeds max weekly load (${teacher.max_weekly_load}).` };
            }
        }

        // 7. Teacher Continuous Load (Fatigue Check — skip for dummy teacher)
        // Teachers should not have more than 3 continuous slots without a break.
        if (teacher && !isDummyTeacher && !proposal.ignoreTeacherConflict && this.timeSlots.length > 0) {
            // Find the slot object for the proposed time_slot_id
            const proposedSlot = this.timeSlots.find(s => s.id === time_slot_id);
            if (proposedSlot && proposedSlot.slot_type !== 'break') {
                // Get all active assignments for this teacher on this day
                const todaysAssignments = activeEntries.filter(t => t.teacher_id === teacher_id && t.day_id === day_id);
                
                // Get the slot_orders of all assigned slots for today, plus the proposed one
                const assignedSlotOrders = todaysAssignments.map(t => {
                    const s = this.timeSlots.find(slot => slot.id === t.time_slot_id);
                    return s ? s.slot_order : null;
                }).filter(order => order !== null);
                
                assignedSlotOrders.push(proposedSlot.slot_order);
                
                // Sort the orders to find consecutive sequences
                assignedSlotOrders.sort((a, b) => a - b);
                
                // Find the longest sequence of consecutive slots
                let maxConsecutive = 1;
                let currentConsecutive = 1;
                
                for (let i = 1; i < assignedSlotOrders.length; i++) {
                    if (assignedSlotOrders[i] === assignedSlotOrders[i - 1] + 1) {
                        // Check if the actual slots between them are breaks.
                        // If they are strictly consecutive in slot_order, they are consecutive in time.
                        // However, if the slot in between is a break, we don't count it as a continuous working slot.
                        // Wait, if slot_order n and n+1 are assigned, it means they are working both.
                        // If there was a break in between, the break would be slot n+1 and the next class would be n+2.
                        // So if they have n and n+1, they are TRULY continuous.
                        currentConsecutive++;
                        if (currentConsecutive > maxConsecutive) {
                            maxConsecutive = currentConsecutive;
                        }
                    } else if (assignedSlotOrders[i] !== assignedSlotOrders[i - 1]) {
                        // Gap encountered, reset
                        currentConsecutive = 1;
                    }
                }
                
                if (maxConsecutive > 3) {
                    return { valid: false, reason: `Teacher ${teacher.short_name} would exceed maximum of 3 continuous classes.` };
                }
            }
        }

        // 8. Single Theory Class Per Day Constraint
        if (subject && subject.subject_type === 'theory' && !proposal.isRemedial && !proposal.isLibrary) {
            const sameSubjectToday = activeEntries.find(t => 
                t.section_id === section_id &&
                t.day_id === day_id &&
                t.subject_id === subject_id &&
                t.time_slot_id !== time_slot_id
            );
            if (sameSubjectToday) {
                return { valid: false, reason: `Theory subject ${subject.subject_name || subject.subject_code} is already scheduled today for this section.` };
            }
        }

        // 9. Lab requirements (needs consecutive slots)

        return { valid: true, reason: null };
    }

    /**
     * Checks if a specific day/slot is a valid working time.
     */
    isValidWorkingTime(day_name, slot_type) {
        if (slot_type === 'break') return false;
        
        const workingDays = this.settings.working_days ? this.settings.working_days.split(',') : [];
        if (!workingDays.includes(day_name)) return false;

        return true;
    }
}

export default ConflictEngine;
