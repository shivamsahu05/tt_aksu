import { v4 as uuidv4 } from 'uuid';

/**
 * Base Strategy Interface
 */
export class SchedulingStrategy {
    constructor(conflictEngine) {
        this.conflictEngine = conflictEngine;
    }

    /**
     * @param {Object} context - Loaded data (sections, subjects, allocations, rooms, days, time_slots)
     * @returns {Array} - Generated timetable entries
     */
    generate(context) {
        throw new Error("Method 'generate()' must be implemented.");
    }
}

/**
 * Greedy Heuristic Strategy
 * Allocates Labs first (requiring 2 slots), then Theory.
 * Rules:
 *  - No same subject scheduled twice on the same day (spread across different days)
 *  - Online sections only scheduled in slots starting at 14:10 or later (after 14:00)
 *  - Labs always consume 2 consecutive slots, shown merged in timetable
 */
export class GreedyHeuristicStrategy extends SchedulingStrategy {

    generate(context) {
        const { allocations, days, timeSlots, rooms, settings } = context;

        let newEntries = [];
        this.conflictEngine.updateContext(newEntries); // Start with empty timetable for this scope

        // Filter valid working days and slots
        const validDays = days.filter(d => this.conflictEngine.isValidWorkingTime(d.name, 'lecture'));
        const validSlots = timeSlots.filter(s => s.slot_type !== 'break');

        // Slots that are >= 14:10 for online classes
        const ONLINE_MIN_HOUR = 14;
        const ONLINE_MIN_MINUTE = 0;
        const isOnlineSlot = (slot) => {
            const [h, m] = slot.start_time.split(':').map(Number);
            return h > ONLINE_MIN_HOUR || (h === ONLINE_MIN_HOUR && m >= ONLINE_MIN_MINUTE);
        };

        // --- BUNDLING LOGIC ---
        // We bundle allocations into "Blocks" to handle merged sections (parallel/shared scheduling).
        const buildBlocks = (allocationsList) => {
            const blocks = [];
            
            // 1. Group allocations by merge_group_id
            const groups = new Map();
            for (const alloc of allocationsList) {
                const sec = context.sections.get(alloc.section_id);
                if (!sec) continue;
                const groupId = sec.merge_group_id || `sec_${alloc.section_id}`;
                if (!groups.has(groupId)) groups.set(groupId, []);
                groups.get(groupId).push(alloc);
            }

            // 2. Process each merge group
            for (const [groupId, groupAllocs] of groups.entries()) {
                const sectionIds = [...new Set(groupAllocs.map(a => a.section_id))];

                const cleanSubjectName = (name) => {
                    if (!name) return '';
                    return String(name).replace(/^(SEC|MDC|VAC|AEC|C|M|DSE|GE|CC|DSC)[-\s\d:]+/i, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                };
                
                const subjectGroups = new Map();
                groupAllocs.forEach(alloc => {
                    const cleaned = cleanSubjectName(alloc.subject_name || alloc.subject_id);
                    const key = cleaned; 
                    if (!subjectGroups.has(key)) subjectGroups.set(key, []);
                    subjectGroups.get(key).push(alloc);
                });

                for (const [key, allocs] of subjectGroups.entries()) {
                    const uniqueSections = new Set(allocs.map(a => a.section_id));
                    
                    if (uniqueSections.size === sectionIds.length && allocs.length === sectionIds.length) {
                        const uniqueTeachers = new Set(allocs.map(a => a.teacher_id));
                        if (uniqueTeachers.size === 1) {
                            blocks.push({ isShared: true, allocations: allocs });
                        } else {
                            blocks.push({ isShared: false, allocations: allocs });
                        }
                    } else {
                        allocs.forEach(alloc => {
                            blocks.push({ isShared: false, allocations: [alloc] });
                        });
                    }
                }
            }
            return blocks;
        };

        const labAllocationsRaw = [];
        const theoryAllocationsRaw = [];
        allocations.forEach(alloc => {
            const name = String(alloc.subject_name || '').toLowerCase();
            const code = String(alloc.subject_code || '').toLowerCase();
            const isNptel = alloc.is_nptel === 1 || alloc.is_nptel === true || Number(alloc.is_nptel) === 1 ||
                /nptel|mooc|swayam/i.test(name) || /nptel|mooc|swayam/i.test(code);
            const aType = String(alloc.allocation_type || '').toLowerCase();
            const sType = String(alloc.subject_type || '').toLowerCase();
            const pCredit = Number(alloc.p_credit || alloc.weekly_practicals || 0);

            const isLab = !isNptel && (
                aType === 'lab' || 
                (aType !== 'theory' && (sType === 'lab' || sType === 'practical' || pCredit > 0 || Boolean(alloc.lab_group_id)))
            );
            if (isLab) labAllocationsRaw.push(alloc);
            else theoryAllocationsRaw.push(alloc);
        });

        const labBlocks = buildBlocks(labAllocationsRaw);
        const theoryBlocks = buildBlocks(theoryAllocationsRaw);

        theoryBlocks.sort((a, b) => {
            const secA = context.sections.get(a.allocations[0].section_id);
            const secB = context.sections.get(b.allocations[0].section_id);
            const hasHomeA = secA && secA.home_room_id ? 1 : 0;
            const hasHomeB = secB && secB.home_room_id ? 1 : 0;
            return hasHomeB - hasHomeA;
        });
        // --- END BUNDLING LOGIC ---

        // Precompute total weekly lecture slots per section (for credit-based day budget)
        // We ONLY count theory slots for the theory cap, but we also compute total slots for active days target.
        const theoryOnlySlotCount = new Map();
        const totalWeeklySlotCount = new Map();
        
        for (const alloc of context.allocationsList || []) {
            const wl = Number(alloc.weekly_lectures || 0);
            const wp = Number(alloc.weekly_practicals || 0);
            const prevTheory = theoryOnlySlotCount.get(alloc.section_id) || 0;
            const prevTotal = totalWeeklySlotCount.get(alloc.section_id) || 0;
            
            theoryOnlySlotCount.set(alloc.section_id, prevTheory + wl);
            totalWeeklySlotCount.set(alloc.section_id, prevTotal + wl + (wp * 2));
        }

        const sectionDailyBudgetMap = new Map();
        const targetActiveDaysMap = new Map();
        
        for (const [secId, totalTheory] of theoryOnlySlotCount.entries()) {
            const cap = Math.max(Math.ceil(totalTheory / Math.max(validDays.length, 1)), 1);
            sectionDailyBudgetMap.set(secId, cap);
        }

        for (const [secId, totalSlots] of totalWeeklySlotCount.entries()) {
            // Enforce Min 2 classes per active day: max active days = floor(total / 2)
            const activeDays = Math.min(validDays.length, Math.max(1, Math.floor(totalSlots / 2)));
            targetActiveDaysMap.set(secId, activeDays);
        }

        // Helper: is this section an online section?
        const isOnlineSection = (sectionId) => {
            const section = context.sections.get(sectionId);
            return section && section.mode === 'Online';
        };

        const isOnlineAlloc = (alloc) => {
            if (!alloc) return false;
            return alloc.is_online === 1 || alloc.is_online === true || Number(alloc.is_online) === 1 || isOnlineSection(alloc.section_id);
        };

        // Helper: exponential day balancing score to guarantee even class distribution across Monday-Saturday
        const getDayBalanceScore = (secDailySlots) => {
            return (5 - secDailySlots) * 5000;
        };

        // Helper: compactness score to ensure CONTINUOUS classes (no empty gaps/holes) for a section on a day
        const getContinuityScore = (sectionId, dayId, proposedSlotOrder) => {
            const section = context.sections.get(sectionId);
            let mergeGroupBonus = 0;
            if (section && section.merge_group_id) {
                const partnerSections = Array.from(context.sections.values()).filter(s => s.merge_group_id === section.merge_group_id && s.id !== sectionId);
                for (const partner of partnerSections) {
                    const partnerEntries = newEntries.filter(e => e.section_id === partner.id && e.day_id === dayId);
                    const partnerOrders = partnerEntries.map(e => {
                        const s = context.timeSlots.find(ts => ts.id === e.time_slot_id);
                        return s ? s.slot_order : -100;
                    });
                    if (partnerOrders.includes(proposedSlotOrder)) {
                        mergeGroupBonus = 20000;
                        break;
                    }
                }
            }

            const sectionEntries = newEntries.filter(e => e.section_id === sectionId && e.day_id === dayId);
            if (sectionEntries.length === 0) {
                return (10 - proposedSlotOrder) * 1000 + mergeGroupBonus; // Prefer earlier slots for the first class of the day
            }
            const existingOrders = sectionEntries.map(e => {
                const s = context.timeSlots.find(ts => ts.id === e.time_slot_id);
                return s ? s.slot_order : -100;
            }).filter(o => o > 0);

            if (existingOrders.length === 0) return 0 + mergeGroupBonus;

            const minOrder = Math.min(...existingOrders);
            const maxOrder = Math.max(...existingOrders);

            if (proposedSlotOrder > minOrder && proposedSlotOrder < maxOrder) {
                return 5000 + mergeGroupBonus; // Filling an internal gap/hole -> highest bonus!
            }

            const sortedValidOrders = validSlots.map(s => s.slot_order).sort((a, b) => a - b);
            const proposedIndex = sortedValidOrders.indexOf(proposedSlotOrder);
            const prevValidOrder = proposedIndex > 0 ? sortedValidOrders[proposedIndex - 1] : -999;
            const nextValidOrder = proposedIndex < sortedValidOrders.length - 1 ? sortedValidOrders[proposedIndex + 1] : -999;

            if (existingOrders.includes(prevValidOrder) || existingOrders.includes(nextValidOrder)) {
                return 3000 + mergeGroupBonus; // Immediately adjacent (no gap!) -> huge bonus!
            }

            // Otherwise, scheduling here creates an empty gap/hole for students!
            // Calculate minimum distance to any existing class order
            let minDist = Math.min(...existingOrders.map(o => Math.abs(o - proposedSlotOrder)));
            return (-6000 * Math.max(1, minDist)) + mergeGroupBonus;
        };

        const getLabContinuityScore = (sectionId, dayId, slot1Order, slot2Order) => {
            const s1 = getContinuityScore(sectionId, dayId, slot1Order);
            const s2 = getContinuityScore(sectionId, dayId, slot2Order);
            return Math.max(s1, s2);
        };

        const checkOccupied = (roomId, dayId, slotId) => {
            return newEntries.some(e => e.room_id === roomId && e.day_id === dayId && e.time_slot_id === slotId) ||
                context.timetable.some(e => e.room_id === roomId && e.day_id === dayId && e.time_slot_id === slotId);
        };

        const homeRoomIds = new Set(Array.from(context.sections.values()).map(s => s.home_room_id).filter(Boolean));

        const findRoom = (alloc, subjectType, dayId, slotId, requiredCapacity, isOnline = false) => {
            const sectionId = alloc.section_id;
            if (isOnline || isOnlineSection(sectionId)) {
                return null;
            }

            const section = context.sections.get(sectionId);
            
            if (alloc && alloc.room_id) {
                if (!checkOccupied(alloc.room_id, dayId, slotId)) {
                    return alloc.room_id;
                }
            }

            if (subjectType === 'theory' && section && section.home_room_id) {
                const homeRoom = context.rooms.get(section.home_room_id);
                if (homeRoom) {
                    if (!checkOccupied(homeRoom.id, dayId, slotId)) {
                        return homeRoom.id;
                    }
                }
            }

            let reqDeptId = null;
            let requiredBuildingId = null;
            if (section && section.building_id) {
                requiredBuildingId = section.building_id;
            }
            if (subjectType === 'lab' && section) {
                reqDeptId = section.department_id;
                if (alloc && alloc.conduct_in_teacher_dept) {
                    const teacher = context.teachers.get(alloc.teacher_id);
                    if (teacher && teacher.department_id) {
                        reqDeptId = teacher.department_id;
                    }
                }
            }

            for (const [roomId, room] of context.rooms.entries()) {
                if (room.room_type === subjectType || room.room_type === 'both') {
                    if (requiredBuildingId && room.building_id !== requiredBuildingId) continue;
                    if (subjectType === 'lab' && reqDeptId && room.department_id !== reqDeptId) continue;
                    if (room.capacity >= requiredCapacity && !homeRoomIds.has(roomId)) {
                        if (!checkOccupied(roomId, dayId, slotId)) return roomId;
                    }
                }
            }

            for (const [roomId, room] of context.rooms.entries()) {
                if (room.room_type === subjectType || room.room_type === 'both') {
                    if (requiredBuildingId && room.building_id !== requiredBuildingId) continue;
                    if (subjectType === 'lab' && reqDeptId && room.department_id !== reqDeptId) continue;
                    if (room.capacity >= requiredCapacity) {
                        if (!checkOccupied(roomId, dayId, slotId)) return roomId;
                    }
                }
            }

            return null;
        };

        const isNptelCourse = (block) => {
            return block.allocations.some(a => {
                if (a.is_nptel === 1 || a.is_nptel === true || Number(a.is_nptel) === 1) return true;
                const name = String(a.subject_name || '').toLowerCase();
                const code = String(a.subject_code || '').toLowerCase();
                return /nptel|mooc|swayam/i.test(name) || /nptel|mooc|swayam/i.test(code);
            });
        };

        // 1. Allocate Theory Lectures (First Priority - ensure daily theory placement)
        for (const block of theoryBlocks) {
            let requiredLectures = block.allocations[0].weekly_lectures || 0;
            const isNptel = isNptelCourse(block);
            if (isNptel) {
                requiredLectures = 1; // All NPTEL/MOOC/SWAYAM subjects (including M.Tech online courses and research MOOCs) get exactly 1 single slot per week
            }
            let isSectionOnline = block.allocations.some(a => isOnlineSection(a.section_id));
            let isOnline = block.allocations.some(a => isOnlineAlloc(a));

            for (let i = 0; i < requiredLectures; i++) {
                let scheduled = false;
                const validSlotsForBlock = [];

                const isHighStrengthClass = block.allocations.some(a => {
                    const s = context.sections.get(a.section_id);
                    return (s?.student_strength || 0) >= 40;
                });

                for (const day of validDays) {
                    let hasSubjectToday = false;
                    for (const alloc of block.allocations) {
                        if (newEntries.some(e => e.section_id === alloc.section_id && e.subject_id === alloc.subject_id && e.day_id === day.id)) {
                            hasSubjectToday = true; break;
                        }
                    }
                    if (hasSubjectToday && requiredLectures <= validDays.length) continue;

                    const secDailySlots = newEntries.filter(e => e.section_id === block.allocations[0].section_id && e.day_id === day.id).length;
                    
                    const teacherIds = [...new Set(block.allocations.map(a => a.teacher_id))];
                    const teacherDailySlots = newEntries.filter(e => teacherIds.includes(e.teacher_id) && e.day_id === day.id).length;
                    
                    for (const slot of validSlots) {
                        let blockUnavailable = false;
                        let blockPreferred = false;
                        for (const alloc of block.allocations) {
                            const teacherPrefs = context.teacherPreferences?.get(alloc.teacher_id) || [];
                            const pref = teacherPrefs.find(p => p.day_id === day.id && p.time_slot_id === slot.id);
                            if (pref?.preference_type === 'unavailable') blockUnavailable = true;
                            if (pref?.preference_type === 'preferred') blockPreferred = true;
                        }

                        if (blockUnavailable) continue;
                        const [startHour] = slot.start_time.split(':').map(Number);
                        validSlotsForBlock.push({ day, slot, isPreferred: blockPreferred, secDailySlots, teacherDailySlots, startHour });
                    }
                }

                validSlotsForBlock.sort((a, b) => {
                    const score = (item) => {
                        let s = 0;
                        if (item.isPreferred) s += 1000;

                        // Online/NPTEL/MOOC → strongly prefer post-lunch (>=14:00).
                        // Soft constraint: if no post-lunch slot is valid the scheduler falls
                        // back gracefully to the best available pre-lunch slot.
                        if (isOnline || isSectionOnline || isNptel) {
                            if (isOnlineSlot(item.slot)) s += 50000; else s -= 30000;
                        }

                        const cont = getContinuityScore(block.allocations[0].section_id, item.day.id, item.slot.slot_order);
                        s += cont;

                        // Prevent theory from stealing lab windows (slots 1, 3, 6, 8) if labs remain unscheduled
                        const sectionHasLabs = labBlocks.some(lb => lb.allocations.some(a => a.section_id === block.allocations[0].section_id));
                        if (sectionHasLabs && [1, 3, 6, 8].includes(item.slot.slot_order)) {
                            s -= 5000; // Mild penalty: keep these slots open for potential labs!
                        }

                        // --- Credit-budget day distribution & Min/Max Classes ---
                        const secId = block.allocations[0].section_id;
                        const dailyCap = sectionDailyBudgetMap.get(secId) || 5;
                        const secTotalDailySlots = newEntries.filter(e => e.section_id === secId && e.day_id === item.day.id).length;

                        if (secTotalDailySlots >= 6) {
                            s -= 100000; // HARD MAX: Never exceed 6 classes per day
                        }

                        if (item.secDailySlots >= dailyCap) {
                            s -= 80000; // Extreme penalty: theory limit exceeded for this day
                        } else if (item.secDailySlots === 0) {
                            const activeDaysUsed = validDays.filter(d => newEntries.some(e => e.section_id === secId && e.day_id === d.id)).length;
                            const maxActiveDays = targetActiveDaysMap.get(secId) || 6;
                            
                            if (activeDaysUsed >= maxActiveDays) {
                                s -= 40000; // Do not open a new day! Forces clustering to achieve Min 2 classes/day.
                            } else {
                                s += 10000; // Bonus for utilizing allowed active days
                            }
                        } else {
                            s += 5000; // Day is already active and under budget. Group classes here!
                        }

                        s += getDayBalanceScore(item.teacherDailySlots) * 0.5;

                        // Strength-based timing: high-strength classes should start early (slot 1 = 9:30).
                        // Low-strength classes can start later. Use a meaningful weight.
                        const isMorning = item.startHour < 12;
                        if (isHighStrengthClass && isMorning) s += 3000;  // Strong bonus: big class → early slot
                        if (!isHighStrengthClass && !isMorning) s += 1000; // Mild bonus: small class can go later
                        
                        // Final year (7th+ semester) should avoid morning slots to leave rooms free for 1st/2nd years
                        const secNode = context.sections.get(secId);
                        if (secNode && secNode.semester >= 7) {
                            if (isMorning) s -= 45000; // Extreme penalty for morning slots for final year
                            else s += 20000;           // Strong bonus for afternoon slots
                        }
                        
                        return s;
                    };
                    return score(b) - score(a);
                });


                for (const { day, slot } of validSlotsForBlock) {
                    if (scheduled) break;

                    let blockValid = true;
                    let pushedCount = 0;

                    const reqCapacityShared = block.allocations.reduce((sum, a) => {
                        const s = context.sections.get(a.section_id);
                        return sum + (s ? s.student_strength : 0);
                    }, 0);

                    let sharedRoomId = null;
                    if (block.isShared) {
                        if (!isOnline) sharedRoomId = findRoom(block.allocations[0], 'theory', day.id, slot.id, reqCapacityShared, isOnline);
                        if (!sharedRoomId && !isOnline) blockValid = false;
                    }

                    if (blockValid) {
                        for (const alloc of block.allocations) {
                            const sec = context.sections.get(alloc.section_id);
                            const reqCapSplit = sec ? sec.student_strength : 0;

                            let roomId = sharedRoomId;
                            if (!block.isShared) {
                                if (!isOnline) roomId = findRoom(alloc, 'theory', day.id, slot.id, reqCapSplit, isOnline);
                            }

                            if (!roomId && !isOnline) { blockValid = false; break; }

                            const prop = {
                                session_id: alloc.session_id, section_id: alloc.section_id, subject_id: alloc.subject_id,
                                teacher_id: alloc.teacher_id, room_id: isOnline ? null : roomId, day_id: day.id, time_slot_id: slot.id, status: 'active',
                                isShared: block.isShared,
                                is_online: isOnline ? 1 : 0
                            };

                            const val = this.conflictEngine.validateAssignment(prop);
                            if (val.valid) {
                                newEntries.push(prop);
                                pushedCount++;
                            } else {
                                blockValid = false;
                                break;
                            }
                        }
                    }

                    if (blockValid) {
                        scheduled = true;
                    } else {
                        // Rollback
                        for (let p = 0; p < pushedCount; p++) {
                            newEntries.pop();
                        }
                    }
                }

                if (!scheduled) {
                    console.warn(`Could not schedule theory lecture ${i + 1} for block starting with subject ${block.allocations[0].subject_name}`);
                }
            }
        }

        // 2. Allocate Labs Second (Requires 2 consecutive slots, penalized if >1 lab on same day)
        for (const block of labBlocks) {
            let requiredSessions = block.allocations[0].weekly_practicals || 0;
            const isNptel = isNptelCourse(block);
            if (isNptel) {
                requiredSessions = 0; // Handled in theory blocks as single slot
            }
            let isSectionOnline = block.allocations.some(a => isOnlineSection(a.section_id));
            let isOnline = block.allocations.some(a => isOnlineAlloc(a));

            for (let i = 0; i < requiredSessions; i++) {
                let scheduled = false;
                const validPairsForBlock = [];

                for (const day of validDays) {
                    let hasLabOnDay = false;
                    for (const alloc of block.allocations) {
                        if (newEntries.some(e => e.section_id === alloc.section_id && e.subject_id === alloc.subject_id && e.day_id === day.id)) {
                            hasLabOnDay = true; break;
                        }
                    }
                    if (hasLabOnDay) continue;

                    for (let s = 0; s < validSlots.length - 1; s++) {
                        const slot1 = validSlots[s];
                        const slot2 = validSlots[s + 1];

                        if (slot2.slot_order - slot1.slot_order !== 1) continue;
                        
                        // Enforce strict 2-slot lab boundaries: P1&P2 (1,2), P3&P4 (3,4), P6&P7 (6,7), P8&P9 (8,9)
                        const validStarts = [1, 3, 6, 8];
                        if (!validStarts.includes(slot1.slot_order)) {
                            continue;
                        }
                        if (isSectionOnline && !isOnlineSlot(slot1)) continue;

                        let blockUnavailable = false;
                        let blockPreferred = false;

                        for (const alloc of block.allocations) {
                            const teacherPrefs = context.teacherPreferences?.get(alloc.teacher_id) || [];
                            const pref1 = teacherPrefs.find(p => p.day_id === day.id && p.time_slot_id === slot1.id);
                            const pref2 = teacherPrefs.find(p => p.day_id === day.id && p.time_slot_id === slot2.id);

                            if (pref1?.preference_type === 'unavailable' || pref2?.preference_type === 'unavailable') blockUnavailable = true;
                            if (pref1?.preference_type === 'preferred' || pref2?.preference_type === 'preferred') blockPreferred = true;
                        }

                        if (blockUnavailable) continue;
                        const startHour = Number(slot1.start_time.split(':')[0]);
                        const secDailySlots = newEntries.filter(e => e.section_id === block.allocations[0].section_id && e.day_id === day.id).length;
                        const teacherIds = [...new Set(block.allocations.map(a => a.teacher_id))];
                        const teacherDailySlots = newEntries.filter(e => teacherIds.includes(e.teacher_id) && e.day_id === day.id).length;
                        const secLabsOnDay = Math.floor(newEntries.filter(e => e.section_id === block.allocations[0].section_id && e.day_id === day.id && (e.lab_group_id || e.is_online === 0)).length / 2);
                        validPairsForBlock.push({ day, slot1, slot2, isPreferred: blockPreferred, startHour, secDailySlots, teacherDailySlots, secLabsOnDay });
                    }
                }

                validPairsForBlock.sort((a, b) => {
                    const score = (item) => {
                        let s = 0;
                        if (item.isPreferred) s += 1000;
                        if (isOnline || isSectionOnline) {
                            if (item.startHour >= 14) s += 5000; else s -= 5000;
                        }

                        // --- Lab Window Optimization ---
                        // Identify lab windows already used today by this section
                        const windowsUsedToday = newEntries
                            .filter(e => e.section_id === block.allocations[0].section_id && e.day_id === item.day.id && e.lab_group_id)
                            .map(e => context.timeSlots.find(ts => ts.id === e.time_slot_id)?.slot_order)
                            .filter(o => [1, 3, 6, 8].includes(o));

                        if (!windowsUsedToday.includes(item.slot1.slot_order)) {
                            s += 8000; // Strong bonus: Use an unused lab window!
                        }

                        // Prefer morning/pre-lunch windows for offline labs to keep afternoons free for online subjects
                        if (!isOnline && !isSectionOnline && [1, 3].includes(item.slot1.slot_order)) {
                            s += 3000;
                        }
                        const secId = block.allocations[0].section_id;
                        const secTotalDailySlots = newEntries.filter(e => e.section_id === secId && e.day_id === item.day.id).length;
                        
                        if (secTotalDailySlots >= 5) {
                            s -= 100000; // HARD MAX: Adding 2 lab slots to >=5 existing would exceed 6!
                        }

                        if (item.secDailySlots === 0) {
                            const activeDaysUsed = validDays.filter(d => newEntries.some(e => e.section_id === secId && e.day_id === d.id)).length;
                            const maxActiveDays = targetActiveDaysMap.get(secId) || 6;
                            
                            if (activeDaysUsed >= maxActiveDays) {
                                s -= 40000; 
                            } else {
                                s += 10000;
                            }
                        } else {
                            s += 5000;
                        }

                        s += getDayBalanceScore(item.teacherDailySlots) * 0.5; // Balance teacher load across days
                        
                        // Final year (7th+ semester) should avoid morning slots to leave rooms free for 1st/2nd years
                        const secNode = context.sections.get(secId);
                        if (secNode && secNode.semester >= 7) {
                            if (item.startHour < 12) s -= 45000;
                            else s += 20000;
                        }
                        
                        return s;
                    };
                    return score(b) - score(a);
                });

                for (const { day, slot1, slot2 } of validPairsForBlock) {
                    if (scheduled) break;

                    let blockValid = true;
                    let pushedCount = 0;

                    const reqCapacityShared = block.allocations.reduce((sum, a) => {
                        const s = context.sections.get(a.section_id);
                        return sum + (s ? s.student_strength : 0);
                    }, 0);

                    let sharedRoomId = null;
                    if (block.isShared) {
                        if (!isOnline) sharedRoomId = findRoom(block.allocations[0], 'lab', day.id, slot1.id, reqCapacityShared, isOnline);
                        if (!sharedRoomId && !isOnline) blockValid = false;
                    }

                    if (blockValid) {
                        const labGroupId = uuidv4();
                        for (const alloc of block.allocations) {
                            const sec = context.sections.get(alloc.section_id);
                            const reqCapSplit = sec ? sec.student_strength : 0;

                            let roomId1 = sharedRoomId;
                            if (!block.isShared) {
                                if (!isOnline) roomId1 = findRoom(alloc, 'lab', day.id, slot1.id, reqCapSplit, isOnline);
                            }

                            if (!roomId1 && !isOnline) { blockValid = false; break; }

                            const prop1 = {
                                session_id: alloc.session_id, section_id: alloc.section_id, subject_id: alloc.subject_id,
                                teacher_id: alloc.teacher_id, room_id: isOnline ? null : roomId1, day_id: day.id, time_slot_id: slot1.id,
                                status: 'active', lab_group_id: labGroupId, isShared: block.isShared,
                                is_online: isOnline ? 1 : 0
                            };
                            const prop2 = { ...prop1, time_slot_id: slot2.id };

                            const val1 = this.conflictEngine.validateAssignment(prop1);
                            if (val1.valid) {
                                newEntries.push(prop1);
                                const val2 = this.conflictEngine.validateAssignment(prop2);
                                if (val2.valid) {
                                    newEntries.push(prop2);
                                    pushedCount += 2;
                                } else {
                                    newEntries.pop(); // rollback prop1
                                    blockValid = false; break;
                                }
                            } else {
                                blockValid = false; break;
                            }
                        }
                    }

                    if (blockValid) {
                        scheduled = true;
                    } else {
                        // Rollback
                        for (let p = 0; p < pushedCount; p++) {
                            newEntries.pop();
                        }
                    }
                }

                if (!scheduled) {
                    console.warn(`Could not schedule lab session ${i + 1} for block starting with subject ${block.allocations[0].subject_name}`);
                }
            }
        }
        // 3. (Phase 3 removed) Remedial & Library are now handled exclusively in Phase 7
        // after all compaction/swapping has finished, to ensure they only fill INTERNAL gaps.

        // 4. Post-Processing Phase: Compact Daily Schedule & Eliminate Internal Gaps
        // Strategy: For each section on each day, try to pack ALL classes as early (left) as possible.
        // This is done by finding the earliest free slot for each class and shifting it there,
        // respecting teacher/room conflicts.
        const compactAndEliminateGaps = () => {
            const sortedSlots = [...validSlots].sort((a, b) => a.slot_order - b.slot_order);

            for (const day of validDays) {
                for (const [secId, sec] of context.sections.entries()) {
                    let secEntries = newEntries.filter(e => e.section_id === sec.id && e.day_id === day.id);
                    if (secEntries.length <= 1) continue;

                    let changed = true;
                    let iterations = 0;
                    while (changed && iterations < 15) {
                        changed = false;
                        iterations++;

                        secEntries = newEntries.filter(e => e.section_id === sec.id && e.day_id === day.id);
                        const minOrder = Math.min(...secEntries.map(e => context.timeSlots.find(s => s.id === e.time_slot_id)?.slot_order || 999));
                        const scheduledOrders = new Set(secEntries.map(e => context.timeSlots.find(s => s.id === e.time_slot_id)?.slot_order));

                        // 1. Pull Left: Try to move any class to the earliest possible empty slot
                        for (const targetSlot of sortedSlots) {
                            if (targetSlot.slot_type === 'break' || scheduledOrders.has(targetSlot.slot_order)) continue;
                            
                            for (let idx = 0; idx < secEntries.length; idx++) {
                                const candidate = secEntries[idx];
                                const candSlot = context.timeSlots.find(s => s.id === candidate.time_slot_id);
                                if (!candSlot || candSlot.slot_order <= targetSlot.slot_order) continue;

                                if (candidate.lab_group_id) {
                                    const partner = secEntries.find(e => e.lab_group_id === candidate.lab_group_id && e !== candidate);
                                    if (!partner) continue;
                                    const partnerSlot = context.timeSlots.find(s => s.id === partner.time_slot_id);
                                    if (!partnerSlot) continue;

                                    const nextTargetSlot = sortedSlots.find(s => s.slot_order === targetSlot.slot_order + 1);
                                    if (nextTargetSlot && nextTargetSlot.slot_type !== 'break' && !scheduledOrders.has(nextTargetSlot.slot_order)) {
                                        // Safely remove both entries by reference using filter
                                        const filteredWithout = newEntries.filter(e => e !== candidate && e !== partner);
                                        const prop1 = { ...candidate, time_slot_id: targetSlot.id };
                                        const prop2 = { ...partner, time_slot_id: nextTargetSlot.id };

                                        newEntries.splice(0, newEntries.length, ...filteredWithout);
                                        if (this.conflictEngine.validateAssignment(prop1).valid && this.conflictEngine.validateAssignment(prop2).valid) {
                                            newEntries.push(prop1, prop2);
                                            changed = true;
                                            break;
                                        } else {
                                            // Rollback
                                            newEntries.splice(0, newEntries.length, ...filteredWithout, candidate, partner);
                                        }
                                    }
                                } else {
                                    // Guard: never shift online/NPTEL entries to a pre-lunch slot.
                                    // If the entry is already post-lunch, only allow moves within post-lunch slots.
                                    if (candidate.is_online === 1 && !isOnlineSlot(targetSlot)) continue;

                                    const candIndex = newEntries.indexOf(candidate);
                                    newEntries.splice(candIndex, 1);
                                    const prop = { ...candidate, time_slot_id: targetSlot.id };
                                    if (this.conflictEngine.validateAssignment(prop).valid) {
                                        newEntries.push(prop);
                                        changed = true;
                                        break;
                                    } else {
                                        newEntries.push(candidate);
                                    }
                                }
                            }
                            if (changed) break;
                        }
                    }
                }
            }
        };

        compactAndEliminateGaps();

        // 5. Second-pass aggressive Pack-Left:
        // After gap elimination, do one more sweep to push ALL classes to the earliest possible slot on their day.
        // This ensures no section starts its day at slot 4 when slots 1,2,3 are free for them.
        const packLeft = () => {
            const sortedSlotsForPack = [...validSlots].sort((a, b) => a.slot_order - b.slot_order);
            let changed = true;
            let passes = 0;
            while (changed && passes < 20) {
                changed = false;
                passes++;
                for (const day of validDays) {
                    for (const [secId, sec] of context.sections.entries()) {
                        // Get all entries for this section on this day, sorted by current slot order
                        const secEnts = newEntries
                            .filter(e => e.section_id === sec.id && e.day_id === day.id)
                            .sort((a, b) => {
                                const sa = context.timeSlots.find(s => s.id === a.time_slot_id)?.slot_order || 0;
                                const sb = context.timeSlots.find(s => s.id === b.time_slot_id)?.slot_order || 0;
                                return sa - sb;
                            });
                        if (secEnts.length === 0) continue;

                        // For each class (from earliest to latest), try to move it to an earlier free slot
                        for (const entry of secEnts) {
                            const currSlot = context.timeSlots.find(s => s.id === entry.time_slot_id);
                            if (!currSlot) continue;

                            // Skip lab pairs - process only the first slot of the pair
                            if (entry.lab_group_id) {
                                const partner = newEntries.find(e => e.lab_group_id === entry.lab_group_id && e !== entry);
                                if (!partner) continue;
                                const partnerSlot = context.timeSlots.find(s => s.id === partner.time_slot_id);
                                if (!partnerSlot || partnerSlot.slot_order < currSlot.slot_order) continue; // Process only the first of the pair

                                // Try to find an earlier consecutive pair of slots
                                for (const target1 of sortedSlotsForPack) {
                                    if (target1.slot_order >= currSlot.slot_order) break;
                                    if (target1.slot_order === 5 || target1.slot_type === 'break') continue;
                                    const target2 = sortedSlotsForPack.find(s => s.slot_order === target1.slot_order + 1);
                                    if (!target2 || target2.slot_order === 5 || target2.slot_type === 'break') continue;

                                    // Check that target slots are free for this section
                                    const sectionBusy = newEntries.some(e =>
                                        e !== entry && e !== partner &&
                                        e.section_id === sec.id && e.day_id === day.id &&
                                        (e.time_slot_id === target1.id || e.time_slot_id === target2.id)
                                    );
                                    if (sectionBusy) continue;

                                    // Safely remove both entries by reference using filter
                                    const filteredWithout = newEntries.filter(e => e !== entry && e !== partner);
                                    const prop1 = { ...entry, time_slot_id: target1.id };
                                    const prop2 = { ...partner, time_slot_id: target2.id };
                                    
                                    // Validate against state without these entries
                                    const savedEntries = newEntries.splice(0, newEntries.length, ...filteredWithout);
                                    const v1 = this.conflictEngine.validateAssignment(prop1);
                                    if (v1.valid) {
                                        newEntries.push(prop1);
                                        const v2 = this.conflictEngine.validateAssignment(prop2);
                                        if (v2.valid) {
                                            newEntries.push(prop2);
                                            entry.time_slot_id = target1.id;
                                            partner.time_slot_id = target2.id;
                                            changed = true;
                                            break;
                                        } else {
                                            // Rollback: restore original entries
                                            newEntries.splice(0, newEntries.length, ...filteredWithout, entry, partner);
                                        }
                                    } else {
                                        // Rollback
                                        newEntries.splice(0, newEntries.length, ...filteredWithout, entry, partner);
                                    }
                                }
                            } else {
                                // Theory class: try to move to an earlier free slot
                                for (const target of sortedSlotsForPack) {
                                    if (target.slot_order >= currSlot.slot_order) break;
                                    if (target.slot_order === 5 || target.slot_type === 'break') continue;

                                    // Guard: don't pull an online/NPTEL entry to a pre-lunch slot.
                                    // This preserves the post-lunch placement set during scheduling.
                                    if (entry.is_online === 1 && !isOnlineSlot(target)) continue;

                                    // Check that target slot is free for this section
                                    const sectionBusy = newEntries.some(e =>
                                        e !== entry &&
                                        e.section_id === sec.id && e.day_id === day.id &&
                                        e.time_slot_id === target.id
                                    );
                                    if (sectionBusy) continue;

                                    const idx = newEntries.indexOf(entry);
                                    if (idx === -1) continue;
                                    newEntries.splice(idx, 1);

                                    const prop = { ...entry, time_slot_id: target.id };
                                    const v = this.conflictEngine.validateAssignment(prop);
                                    if (v.valid) {
                                        newEntries.push(prop);
                                        entry.time_slot_id = target.id;
                                        changed = true;
                                        break;
                                    } else {
                                        newEntries.push(entry);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        };

        compactAndEliminateGaps();

        const perfectDayCompaction = () => {
            const validOrders = validSlots.filter(s => s.slot_type !== 'break').map(s => s.slot_order).sort((a,b) => a-b);
            
            for (const day of validDays) {
                for (const [secId, sec] of context.sections.entries()) {
                    let secEntries = newEntries.filter(e => e.section_id === sec.id && e.day_id === day.id && !e.isShared);
                    if (secEntries.length <= 1) continue;

                    // Sort entries by their current slot order to maintain relative sequence
                    secEntries.sort((a, b) => {
                        const sA = context.timeSlots.find(s => s.id === a.time_slot_id)?.slot_order || 0;
                        const sB = context.timeSlots.find(s => s.id === b.time_slot_id)?.slot_order || 0;
                        return sA - sB;
                    });

                    const numClasses = secEntries.length;
                    
                    // Generate all possible contiguous sequences of length `numClasses`
                    const possibleSequences = [];
                    for (let i = 0; i <= validOrders.length - numClasses; i++) {
                        const seq = validOrders.slice(i, i + numClasses);
                        
                        // Rule: If sequence contains a lab, the lab must fall on a valid lab window (1,2 / 3,4 / 6,7 / 8,9)
                        let labValid = true;
                        for (let j = 0; j < numClasses; j++) {
                            const entry = secEntries[j];
                            if (entry.lab_group_id) {
                                // Find partner in secEntries
                                const partnerIdx = secEntries.findIndex(e => e.lab_group_id === entry.lab_group_id && e !== entry);
                                if (partnerIdx === -1) continue; // Should not happen
                                
                                // They must be adjacent in the sequence
                                if (Math.abs(partnerIdx - j) !== 1) { labValid = false; break; }
                                
                                // The first of the pair must start at a valid lab window
                                const firstIdx = Math.min(j, partnerIdx);
                                const firstOrder = seq[firstIdx];
                                if (![1, 3, 6, 8].includes(firstOrder)) { labValid = false; break; }
                            }
                            // Online classes must be in online slots (post-lunch usually)
                            if (entry.is_online === 1) {
                                const targetSlot = validSlots.find(s => s.slot_order === seq[j]);
                                if (targetSlot && !isOnlineSlot(targetSlot)) { labValid = false; break; }
                            }
                        }
                        
                        if (labValid) possibleSequences.push(seq);
                    }
                    
                    // Check if current assignment is already contiguous
                    const currentOrders = secEntries.map(e => context.timeSlots.find(s => s.id === e.time_slot_id)?.slot_order);
                    const isContiguous = currentOrders.every((ord, idx) => {
                        if (idx === 0) return true;
                        const expectedPrevIndex = validOrders.indexOf(ord) - 1;
                        return expectedPrevIndex >= 0 && validOrders[expectedPrevIndex] === currentOrders[idx - 1];
                    });
                    
                    if (isContiguous) continue; // Already perfect!

                    // Try to map to one of the possible sequences
                    for (const seq of possibleSequences) {
                        const filteredWithout = newEntries.filter(e => !secEntries.includes(e));
                        const proposedEntries = secEntries.map((e, idx) => {
                            const targetSlot = validSlots.find(s => s.slot_order === seq[idx]);
                            return { ...e, time_slot_id: targetSlot.id };
                        });
                        
                        // Validate all proposed entries sequentially
                        newEntries.splice(0, newEntries.length, ...filteredWithout);
                        let allValid = true;
                        for (const prop of proposedEntries) {
                            if (!this.conflictEngine.validateAssignment(prop).valid) {
                                allValid = false;
                                break;
                            }
                            newEntries.push(prop); 
                        }
                        
                        if (allValid) {
                            // Success! The entire block is now contiguous.
                            break; 
                        } else {
                            // Rollback
                            newEntries.splice(0, newEntries.length, ...filteredWithout, ...secEntries);
                        }
                    }
                }
            }
        };

        perfectDayCompaction();
        // 6. Advanced Gap Compression & N/A Floating Room Allocation (Post-Processing V2)
        const compressGapsAndOptimize = () => {
            if (!validSlots || validSlots.length === 0) return;
            const LUNCH_ORDER = 5;
            const sortedValidSlots = [...validSlots].sort((a, b) => a.slot_order - b.slot_order);
            
            const getSlotByOrder = (order) => sortedValidSlots.find(s => s.slot_order === order);
            const getOrder = (slotId) => {
                const s = sortedValidSlots.find(s => s.id === slotId);
                return s ? s.slot_order : -1;
            };

            let iteration = 0;
            const MAX_ITERATIONS = 5;
            let totalShifted = 0;

            const findAvailableRoom = (entry, targetSlotIds, minCapacity) => {
                const alloc = context.allocationsList.find(a => a.section_id === entry.section_id && a.subject_id === entry.subject_id);
                if (alloc && alloc.room_id) return null; // DO NOT float rooms that have explicit overrides
                
                const isLab = alloc && (alloc.allocation_type === 'lab' || alloc.subject_type === 'lab' || alloc.p_credit > 0);
                              let reqDeptId = null;
                let requiredBuildingId = null;
                const section = context.sections.get(entry.section_id);
                if (section && section.building_id) {
                    requiredBuildingId = section.building_id;
                }
                
                if (isLab) {
                    reqDeptId = section ? section.department_id : null;
                    if (alloc && alloc.conduct_in_teacher_dept) {
                        const teacher = context.teachers.get(alloc.teacher_id);
                        if (teacher && teacher.department_id) reqDeptId = teacher.department_id;
                    }
                }
                
                const candidates = Array.from(context.rooms.values()).filter(r => {
                    if (requiredBuildingId && r.building_id !== requiredBuildingId) return false;
                    if (isLab && r.room_type !== 'lab') return false;
                    if (!isLab && r.room_type === 'lab') return false;
                    if (isLab && reqDeptId && r.department_id !== reqDeptId) return false;
                    if (r.capacity < minCapacity * 0.70) return false;
                    return true;
                });
                candidates.sort((a, b) => a.capacity - b.capacity);
                
                for (const room of candidates) {
                    const tempId = entry.room_id;
                    entry.room_id = room.id;
                    
                    let validBlock = true;
                    for (const tSlot of targetSlotIds) {
                        entry.time_slot_id = tSlot;
                        this.conflictEngine.updateContext(newEntries);
                        if (!this.conflictEngine.validateAssignment(entry).valid) {
                            validBlock = false;
                            break;
                        }
                    }
                    if (validBlock) return room.id;
                    entry.room_id = tempId;
                }
                return null;
            };

            while (iteration < MAX_ITERATIONS) {
                let shiftedThisPass = 0;
                let swappedThisPass = 0;
                
                for (const [, sec] of context.sections.entries()) {
                    for (const day of validDays) {
                        // Ignore isShared blocks here so they are not moved independently, breaking synchronization
                        const secEntries = newEntries.filter(e => e.section_id === sec.id && e.day_id === day.id && !e.isLibrary && !e.isRemedial && !e.isShared);
                        if (secEntries.length < 2) continue;

                        const sessionGroups = new Map();
                        for (const e of secEntries) {
                            const sid = e.session_id || (e.time_slot_id + '_' + e.subject_id);
                            if (!sessionGroups.has(sid)) sessionGroups.set(sid, []);
                            sessionGroups.get(sid).push(e);
                        }

                        const sessions = Array.from(sessionGroups.values());
                        sessions.sort((a, b) => {
                            const minA = Math.min(...a.map(e => getOrder(e.time_slot_id)));
                            const minB = Math.min(...b.map(e => getOrder(e.time_slot_id)));
                            return minB - minA;
                        });
                        
                        for (const group of sessions) {
                            const allOrders = secEntries.map(e => getOrder(e.time_slot_id));
                            const minDayOrder = Math.min(...allOrders);
                            
                            const groupOrders = group.map(e => getOrder(e.time_slot_id));
                            const groupMinOrder = Math.min(...groupOrders);
                            const groupSize = group.length;

                            if (groupMinOrder <= minDayOrder) continue; 
                            
                            for (let startOrder = minDayOrder; startOrder <= groupMinOrder - groupSize; startOrder++) {
                                let canFit = true;
                                const targetSlots = [];
                                
                                for (let offset = 0; offset < groupSize; offset++) {
                                    const checkOrder = startOrder + offset;
                                    if (checkOrder === LUNCH_ORDER) { canFit = false; break; }
                                    if (allOrders.includes(checkOrder)) { canFit = false; break; }
                                    const s = getSlotByOrder(checkOrder);
                                    if (!s) { canFit = false; break; }
                                    targetSlots.push(s.id);
                                }
                                if (!canFit) continue;
                                
                                let allValid = true;
                                const backups = group.map(e => ({ id: e.time_slot_id, room: e.room_id }));
                                group.sort((a, b) => getOrder(a.time_slot_id) - getOrder(b.time_slot_id));
                                
                                for (let j = 0; j < groupSize; j++) {
                                    group[j].time_slot_id = targetSlots[j];
                                }
                                this.conflictEngine.updateContext(newEntries);
                                
                                let reqSwap = false;
                                let reqFloating = false;
                                
                                for (let j = 0; j < groupSize; j++) {
                                    const val = this.conflictEngine.validateAssignment(group[j], group[j]);
                                    if (!val.valid) {
                                        allValid = false;
                                        if (val.reason && val.reason.includes('Teacher')) reqSwap = true;
                                        if (val.reason && val.reason.includes('Room')) reqFloating = true;
                                    }
                                }
                                
                                if (allValid) {
                                    shiftedThisPass += groupSize;
                                    break;
                                } else if (reqFloating && !reqSwap) {
                                    const newRoomId = findAvailableRoom(group[0], targetSlots, sec.student_strength || 30);
                                    if (newRoomId) {
                                        group.forEach(g => g.room_id = newRoomId);
                                        shiftedThisPass += groupSize;
                                        break;
                                    }
                                } else if (reqSwap && groupSize === 1) {
                                    const entry = group[0];
                                    const blockingEntry = newEntries.find(e => e.teacher_id === entry.teacher_id && e.day_id === day.id && e.time_slot_id === targetSlots[0] && e.section_id !== entry.section_id);
                                    
                                    if (blockingEntry && !blockingEntry.isShared) {
                                        const sectionBClash = newEntries.find(e => 
                                            e.section_id === blockingEntry.section_id && 
                                            e.day_id === day.id && 
                                            e.time_slot_id === backups[0].id &&
                                            e !== blockingEntry
                                        );
                                        
                                        if (!sectionBClash) {
                                            const oldBlockerSlot = blockingEntry.time_slot_id;
                                            blockingEntry.time_slot_id = backups[0].id;
                                            this.conflictEngine.updateContext(newEntries);
                                            
                                            if (this.conflictEngine.validateAssignment(entry, entry).valid && this.conflictEngine.validateAssignment(blockingEntry, blockingEntry).valid) {
                                                swappedThisPass++;
                                                shiftedThisPass++;
                                                break;
                                            }
                                            blockingEntry.time_slot_id = oldBlockerSlot;
                                        }
                                    }
                                }
                                
                                for (let j = 0; j < groupSize; j++) {
                                    group[j].time_slot_id = backups[j].id;
                                    group[j].room_id = backups[j].room;
                                }
                            }
                        }
                    }
                }
                totalShifted += shiftedThisPass;
                if (shiftedThisPass === 0 && swappedThisPass === 0) break;
                iteration++;
            }
            console.log(`[Gap Compression V2] Passed ${iteration} times. Shifted/Swapped ${totalShifted} classes.`);

            let sparseDaysFixed = 0;
            for (const [, sec] of context.sections.entries()) {
                const dayCounts = [];
                for (const day of validDays) {
                    const cnt = newEntries.filter(e => e.section_id === sec.id && e.day_id === day.id && !e.isLibrary && !e.isRemedial).length;
                    dayCounts.push({ day, cnt });
                }
                
                const sparseDays = dayCounts.filter(dc => dc.cnt === 1);
                if (sparseDays.length === 0) continue;
                
                const busyDays = dayCounts.filter(dc => dc.cnt >= 2).sort((a, b) => a.cnt - b.cnt); 
                
                for (const sparse of sparseDays) {
                    const entryToMove = newEntries.find(e => e.section_id === sec.id && e.day_id === sparse.day.id && !e.isLibrary && !e.isRemedial);
                    if (!entryToMove || entryToMove.isShared) continue;

                    let moved = false;
                    const oldDay = entryToMove.day_id;
                    const oldSlot = entryToMove.time_slot_id;

                    for (const busy of busyDays) {
                        if (moved) break;
                        const busyEntries = newEntries.filter(e => e.section_id === sec.id && e.day_id === busy.day.id);
                        const busySlotIds = busyEntries.map(e => e.time_slot_id);
                        
                        for (const s of sortedValidSlots) {
                            if (s.slot_order === LUNCH_ORDER) continue;
                            if (!busySlotIds.includes(s.id)) {
                                entryToMove.day_id = busy.day.id;
                                entryToMove.time_slot_id = s.id;
                                this.conflictEngine.updateContext(newEntries);
                                if (this.conflictEngine.validateAssignment(entryToMove, entryToMove).valid) {
                                    moved = true;
                                    sparseDaysFixed++;
                                    busy.cnt++;
                                    break;
                                }
                            }
                        }
                    }
                    if (!moved) {
                        entryToMove.day_id = oldDay;
                        entryToMove.time_slot_id = oldSlot;
                    }
                }
            }
            console.log(`[Sparse Days V2] Eliminated ${sparseDaysFixed} isolated classes.`);
        };

        // 7. Assign Remedial (1/week) and Library (fill remaining gaps)
        

        const fillInternalGapsFromOtherDays = () => {
            if (!validSlots || validSlots.length === 0) return;
            const LUNCH_ORDER = 5;
            const sortedValidSlots = [...validSlots].sort((a, b) => a.slot_order - b.slot_order);
            const getOrder = (slotId) => {
                const s = sortedValidSlots.find(s => s.id === slotId);
                return s ? s.slot_order : -1;
            };

            for (const [, sec] of context.sections.entries()) {
                for (const day of validDays) {
                    const secEntries = newEntries.filter(e => e.section_id === sec.id && e.day_id === day.id);
                    if (secEntries.length < 1) continue;
                    
                    const orders = secEntries.map(e => getOrder(e.time_slot_id));
                    const minOrder = Math.min(...orders);
                    const maxOrder = Math.max(...orders);
                    
                    const gaps = [];
                    for (let order = minOrder + 1; order < maxOrder; order++) {
                        if (order === LUNCH_ORDER) continue;
                        if (!orders.includes(order)) {
                            const slot = sortedValidSlots.find(s => s.slot_order === order);
                            if (slot) gaps.push(slot);
                        }
                    }
                    
                    if (gaps.length === 0) continue;
                    
                    const otherDays = validDays.filter(d => d.id !== day.id);
                    
                    for (const gapSlot of gaps) {
                        let filled = false;
                        
                        const otherDayStats = otherDays.map(d => {
                            const entries = newEntries.filter(e => e.section_id === sec.id && e.day_id === d.id && !e.isLibrary && !e.isRemedial);
                            return { day: d, entries, count: entries.length };
                        }).sort((a, b) => b.count - a.count);
                        
                        for (const stat of otherDayStats) {
                            if (filled) break;
                            if (stat.count === 0) continue;
                            
                            const eOrders = stat.entries.map(e => getOrder(e.time_slot_id));
                            const eMin = Math.min(...eOrders);
                            const eMax = Math.max(...eOrders);
                            
                            const candidatesToMove = stat.entries.filter(e => {
                                const ord = getOrder(e.time_slot_id);
                                return ord === eMin || ord === eMax;
                            });
                            
                            for (const candidate of candidatesToMove) {
                                if (candidate.lab_group_id) continue;
                                
                                const relatedEntries = newEntries.filter(e => 
                                    e.teacher_id === candidate.teacher_id && 
                                    e.day_id === candidate.day_id && 
                                    e.time_slot_id === candidate.time_slot_id &&
                                    e.subject_id === candidate.subject_id
                                );
                                
                                let canMoveAll = true;
                                for (const re of relatedEntries) {
                                    const occupied = newEntries.some(e => e !== re && e.section_id === re.section_id && e.day_id === day.id && e.time_slot_id === gapSlot.id);
                                    if (occupied) { canMoveAll = false; break; }
                                }
                                
                                if (!canMoveAll) continue;
                                
                                const backups = relatedEntries.map(re => ({ day: re.day_id, slot: re.time_slot_id }));
                                
                                relatedEntries.forEach(re => {
                                    re.day_id = day.id;
                                    re.time_slot_id = gapSlot.id;
                                });
                                
                                this.conflictEngine.updateContext(newEntries);
                                
                                let allValid = true;
                                for (const re of relatedEntries) {
                                    if (!this.conflictEngine.validateAssignment(re, re).valid) {
                                        allValid = false;
                                        break;
                                    }
                                }
                                
                                if (allValid) {
                                    filled = true;
                                    break;
                                } else {
                                    relatedEntries.forEach((re, idx) => {
                                        re.day_id = backups[idx].day;
                                        re.time_slot_id = backups[idx].slot;
                                    });
                                }
                            }
                        }
                    }
                }
            }
        };
        fillInternalGapsFromOtherDays();

        const assignLibrary = () => {
            if (!context.librarySubjectId || !context.dummyTeacherId) return;
            const LUNCH_ORDER = 5;
            const sortedValidSlots = [...validSlots].sort((a, b) => a.slot_order - b.slot_order);
            const getOrder = (slotId) => {
                const s = sortedValidSlots.find(s => s.id === slotId);
                return s ? s.slot_order : -1;
            };

            const libraryAllotmentMap = new Map();
            for (const allotment of (context.libraryAllotments || [])) {
                for (const classId of allotment.classIds) {
                    if (!libraryAllotmentMap.has(classId)) {
                        libraryAllotmentMap.set(classId, new Set());
                    }
                    for (const dayName of allotment.days) {
                        libraryAllotmentMap.get(classId).add(dayName.toLowerCase());
                    }
                }
            }

            const isLibraryAllottedForDay = (sec, dayName) => {
                if (!sec) return false;
                const allowedDays = libraryAllotmentMap.get(sec.class_id);
                if (!allowedDays) return false;
                return allowedDays.has(dayName.toLowerCase());
            };

            const createEntry = (subjectId, dayId, slotId, isLib, isRem, isSelfLearning, isSharedGap, sec) => {
                const allocForSec = context.allocationsList.find(a => a.section_id === sec.id);
                return {
                    session_id: sec.session_id || (allocForSec ? allocForSec.session_id : 1),
                    section_id: sec.id,
                    subject_id: subjectId,
                    teacher_id: context.dummyTeacherId,
                    room_id: sec.home_room_id || null,
                    day_id: dayId,
                    time_slot_id: slotId,
                    status: 'active',
                    is_online: 0,
                    isLibrary: isLib,
                    isRemedial: isRem,
                    isSelfLearning: isSelfLearning || false,
                    isShared: isSharedGap
                };
            };

            const groupedSections = new Map();
            for (const [secId, sec] of context.sections.entries()) {
                const groupId = sec.merge_group_id || `sec_${sec.id}`;
                if (!groupedSections.has(groupId)) groupedSections.set(groupId, []);
                groupedSections.get(groupId).push(sec);
            }

            const findRoom = (dayId, slotId, minCapacity, preferredRoomId, requiredBuildingId) => {
                if (preferredRoomId) {
                    const isBusy = newEntries.some(e => e.room_id === preferredRoomId && e.day_id === dayId && e.time_slot_id === slotId);
                    if (!isBusy) return preferredRoomId;
                }
                const candidates = Array.from(context.rooms.values()).filter(r => {
                    if (r.room_type === 'lab') return false;
                    if (requiredBuildingId && r.building_id !== requiredBuildingId) return false;
                    if (r.capacity < minCapacity * 0.70) return false;
                    return true;
                });
                candidates.sort((a, b) => a.capacity - b.capacity);
                for (const room of candidates) {
                    const isBusy = newEntries.some(e => e.room_id === room.id && e.day_id === dayId && e.time_slot_id === slotId);
                    if (!isBusy) return room.id;
                }
                return null;
            };

            for (const [groupId, secsInGroup] of groupedSections.entries()) {
                for (const day of validDays) {
                    const dayName = (day.name || '').toLowerCase();
                    let groupAllotted = false;
                    for (const sec of secsInGroup) {
                        if (isLibraryAllottedForDay(sec, dayName)) {
                            groupAllotted = true;
                            break;
                        }
                    }
                    if (!groupAllotted) continue;

                    const alreadyHasLib = newEntries.some(e =>
                        secsInGroup.map(s => s.id).includes(e.section_id) && 
                        e.day_id === day.id && 
                        (e.isLibrary || e.subject_id === context.librarySubjectId)
                    );
                    if (alreadyHasLib) continue;

                    const occupiedSlotIds = new Set();
                    for (const sec of secsInGroup) {
                        newEntries.filter(e => e.section_id === sec.id && e.day_id === day.id)
                                  .forEach(e => occupiedSlotIds.add(e.time_slot_id));
                    }
                    
                    const freeSlots = sortedValidSlots.filter(s => s.slot_order !== LUNCH_ORDER && !occupiedSlotIds.has(s.id));
                    if (freeSlots.length === 0) continue;

                    const occupiedOrders = [...occupiedSlotIds].map(sid => getOrder(sid)).filter(o => o > 0).sort((a, b) => a - b);
                    const candidates = [];
                    if (occupiedOrders.length > 0) {
                        const firstClassOrder = occupiedOrders[0];
                        const lastClassOrder = occupiedOrders[occupiedOrders.length - 1];
                        const beforeSlots = freeSlots.filter(s => s.slot_order < firstClassOrder).sort((a, b) => b.slot_order - a.slot_order);
                        candidates.push(...beforeSlots);
                        const afterSlots = freeSlots.filter(s => s.slot_order > lastClassOrder).sort((a, b) => a.slot_order - b.slot_order);
                        candidates.push(...afterSlots);
                    } else {
                        candidates.push(...freeSlots.slice(0, 1));
                    }

                    const groupStrength = secsInGroup.reduce((sum, sec) => sum + (sec.student_strength || 30), 0);
                    const preferredRoom = secsInGroup[0].home_room_id;
                    const requiredBuildingId = secsInGroup[0].building_id || null;
                    const isSharedGap = secsInGroup.length > 1;

                    let placed = false;
                    for (const candidate of candidates) {
                        // CRITICAL: Never place library into a slot already occupied by this section
                        const slotOccupiedBySection = secsInGroup.some(sec =>
                            newEntries.some(e => e.section_id === sec.id && e.day_id === day.id && e.time_slot_id === candidate.id)
                        );
                        if (slotOccupiedBySection) continue;

                        const roomId = findRoom(day.id, candidate.id, groupStrength, preferredRoom, requiredBuildingId);
                        if (!roomId) continue; 
                        
                        for (const sec of secsInGroup) {
                            const entry = createEntry(context.librarySubjectId, day.id, candidate.id, true, false, false, isSharedGap, sec);
                            entry.room_id = roomId;
                            newEntries.push(entry);
                        }
                        placed = true;
                        break;
                    }
                    
                    // Fallback: place without a dedicated room if needed, but NEVER into an occupied slot
                    if (!placed && candidates.length > 0) {
                        const safeCandidate = candidates.find(candidate =>
                            !secsInGroup.some(sec =>
                                newEntries.some(e => e.section_id === sec.id && e.day_id === day.id && e.time_slot_id === candidate.id)
                            )
                        );
                        if (safeCandidate) {
                            for (const sec of secsInGroup) {
                                const entry = createEntry(context.librarySubjectId, day.id, safeCandidate.id, true, false, false, isSharedGap, sec);
                                entry.room_id = preferredRoom || null;
                                newEntries.push(entry);
                            }
                        }
                        // If no safe candidate found, skip - do not force library into an occupied slot
                    }
                }
            }
        };

        const assignRemedialAndSelfLearning = () => {
            if (!context.remedialSubjectId || !context.dummyTeacherId) return;
            const LUNCH_ORDER = 5;
            const sortedValidSlots = [...validSlots].sort((a, b) => a.slot_order - b.slot_order);
            const getOrder = (slotId) => {
                const s = sortedValidSlots.find(s => s.id === slotId);
                return s ? s.slot_order : -1;
            };

            const createEntry = (subjectId, dayId, slotId, isLib, isRem, isSelfLearning, isSharedGap, sec) => {
                const allocForSec = context.allocationsList.find(a => a.section_id === sec.id);
                return {
                    session_id: sec.session_id || (allocForSec ? allocForSec.session_id : 1),
                    section_id: sec.id,
                    subject_id: subjectId,
                    teacher_id: context.dummyTeacherId,
                    room_id: sec.home_room_id || null,
                    day_id: dayId,
                    time_slot_id: slotId,
                    status: 'active',
                    is_online: 0,
                    isLibrary: isLib,
                    isRemedial: isRem,
                    isSelfLearning: isSelfLearning || false,
                    isShared: isSharedGap
                };
            };

            const groupedSections = new Map();
            for (const [secId, sec] of context.sections.entries()) {
                const groupId = sec.merge_group_id || `sec_${sec.id}`;
                if (!groupedSections.has(groupId)) groupedSections.set(groupId, []);
                groupedSections.get(groupId).push(sec);
            }

            const findRoom = (dayId, slotId, minCapacity, preferredRoomId, requiredBuildingId) => {
                if (preferredRoomId) {
                    const isBusy = newEntries.some(e => e.room_id === preferredRoomId && e.day_id === dayId && e.time_slot_id === slotId);
                    if (!isBusy) return preferredRoomId;
                }
                const candidates = Array.from(context.rooms.values()).filter(r => {
                    if (r.room_type === 'lab') return false;
                    if (requiredBuildingId && r.building_id !== requiredBuildingId) return false;
                    if (r.capacity < minCapacity * 0.70) return false;
                    return true;
                });
                candidates.sort((a, b) => a.capacity - b.capacity);
                for (const room of candidates) {
                    const isBusy = newEntries.some(e => e.room_id === room.id && e.day_id === dayId && e.time_slot_id === slotId);
                    if (!isBusy) return room.id;
                }
                return null;
            };

            for (const [groupId, secsInGroup] of groupedSections.entries()) {
                const sectionGaps = new Map();

                for (const sec of secsInGroup) {
                    let gaps = [];
                    for (const day of validDays) {
                        const coreEntries = newEntries.filter(e => e.section_id === sec.id && e.day_id === day.id && !e.isLibrary && !e.isRemedial && !e.isSelfLearning);
                        const allEntries = newEntries.filter(e => e.section_id === sec.id && e.day_id === day.id);

                        if (coreEntries.length < 2) continue;

                        const coreOrders = coreEntries.map(e => getOrder(e.time_slot_id));
                        const minOrder = Math.min(...coreOrders);
                        const maxOrder = Math.max(...coreOrders);
                        const occupiedOrders = allEntries.map(e => getOrder(e.time_slot_id));

                        for (const slot of sortedValidSlots) {
                            if (slot.slot_order > minOrder && slot.slot_order < maxOrder && slot.slot_order !== LUNCH_ORDER) {
                                if (!occupiedOrders.includes(slot.slot_order)) {
                                    gaps.push({ day_id: day.id, slot: slot });
                                }
                            }
                        }
                    }
                    sectionGaps.set(sec.id, gaps);
                }

                const gapMap = new Map();
                for (const [secId, gaps] of sectionGaps.entries()) {
                    for (const gap of gaps) {
                        const key = gap.day_id + '-' + gap.slot.id;
                        if (!gapMap.has(key)) gapMap.set(key, { day_id: gap.day_id, slot: gap.slot, secIds: [] });
                        gapMap.get(key).secIds.push(secId);
                    }
                }

                const gapArray = Array.from(gapMap.values());
                gapArray.sort((a, b) => {
                    if (a.day_id !== b.day_id) return a.day_id - b.day_id;
                    return getOrder(a.slot.id) - getOrder(b.slot.id);
                });

                for (const gap of gapArray) {
                    const isSharedGap = gap.secIds.length === secsInGroup.length;
                    let assignRemedial = false;

                    if (secsInGroup.length > 1) {
                        if (isSharedGap) {
                            const groupHasRemedial = newEntries.some(e => secsInGroup.map(s => s.id).includes(e.section_id) && (e.subject_id === context.remedialSubjectId || e.isRemedial));
                            assignRemedial = !groupHasRemedial;
                        }
                    } else {
                        const secId = gap.secIds[0];
                        const secHasRemedial = newEntries.some(e => e.section_id === secId && (e.subject_id === context.remedialSubjectId || e.isRemedial));
                        assignRemedial = !secHasRemedial;
                    }
                    
                    const gapSecs = gap.secIds.map(id => context.sections.get(id));
                    const groupStrength = gapSecs.reduce((sum, sec) => sum + (sec.student_strength || 30), 0);
                    const preferredRoom = gapSecs[0].home_room_id;
                    const requiredBuildingId = gapSecs[0].building_id || null;
                    const roomId = findRoom(gap.day_id, gap.slot.id, groupStrength, preferredRoom, requiredBuildingId);

                    for (const secId of gap.secIds) {
                        const sec = context.sections.get(secId);
                        let isRem = false;

                        if (secsInGroup.length > 1) {
                            isRem = isSharedGap ? assignRemedial : false;
                        } else {
                            const secHasRemedial = newEntries.some(e => e.section_id === secId && (e.subject_id === context.remedialSubjectId || e.isRemedial));
                            if (assignRemedial && !secHasRemedial) {
                                isRem = true;
                                assignRemedial = false;
                            }
                        }

                        let useSelfLearning = false;
                        if (!isRem && context.selfLearningSubjectId) {
                            const secSlCount = newEntries.filter(e => e.section_id === secId && e.isSelfLearning).length;
                            if (secSlCount < 3) { // Max 3 Self Learning per week
                                useSelfLearning = true;
                            }
                        }

                        if (!isRem && !useSelfLearning) {
                            continue; // Leave the gap empty, don't assign anything
                        }

                        const subjId = isRem ? context.remedialSubjectId : context.selfLearningSubjectId;
                        const isLib = false;
                        const isSL = useSelfLearning;

                        const entry = createEntry(subjId, gap.day_id, gap.slot.id, isLib, isRem, isSL, isSharedGap, sec);
                        entry.room_id = roomId || preferredRoom || null;
                        newEntries.push(entry);
                    }
                }
            }
        };

        fillInternalGapsFromOtherDays();
        assignLibrary();
        compressGapsAndOptimize();
        assignRemedialAndSelfLearning();

        return newEntries;
    }
}
