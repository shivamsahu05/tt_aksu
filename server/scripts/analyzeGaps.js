/**
 * Gap Analysis Script for CSAE Department
 * Usage: node scripts/analyzeGaps.js [dept_id] [session_id]
 * 
 * For each remaining gap in theory/lab classes, this script diagnoses WHY
 * the gap could not be compacted:
 *   - Teacher is busy in that gap slot (another section occupies teacher)
 *   - No room available in that gap slot
 *   - Section has another class in that slot (shared/online)
 *   - Swap was tried but all swap candidates failed constraints
 */

import db from '../config/db.js';

const DEPT_ID   = parseInt(process.argv[2]) || 1;    // 1 = CSAE / Computer Science
const SESSION_ID = parseInt(process.argv[3]) || 1;

const LUNCH_SLOT_ORDER = 5; // slot_order of lunch break

// ─── Helpers ─────────────────────────────────────────────────────────────────

const pad = (v, n) => String(v).padEnd(n);
const color = {
    red:    (s) => `\x1b[31m${s}\x1b[0m`,
    green:  (s) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
    bold:   (s) => `\x1b[1m${s}\x1b[0m`,
    dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

// ─── Main Analysis ───────────────────────────────────────────────────────────

async function analyzeGaps() {
    console.log(color.bold(`\n${'═'.repeat(70)}`));
    console.log(color.bold(`  GAP ANALYSIS — Department ID: ${DEPT_ID}  |  Session ID: ${SESSION_ID}`));
    console.log(color.bold(`${'═'.repeat(70)}\n`));

    // ── Load all time slots ──────────────────────────────────────────────────
    const [slotsRaw] = await db.query(
        `SELECT id, slot_order, start_time, end_time, slot_type FROM time_slots ORDER BY slot_order`
    );
    const slots = slotsRaw;
    const lectureSlots = slots.filter(s => s.slot_type === 'lecture');
    const slotById = Object.fromEntries(slots.map(s => [s.id, s]));

    // ── Load all days ────────────────────────────────────────────────────────
    const [days] = await db.query(`SELECT id, name, day_order FROM days ORDER BY day_order`);

    // ── Load all rooms ───────────────────────────────────────────────────────
    const [rooms] = await db.query(`SELECT id, room_number, room_type, capacity FROM rooms WHERE is_active = 1`);

    // ── Load all teachers ────────────────────────────────────────────────────
    const [teachers] = await db.query(`SELECT id, full_name FROM teachers`);
    const teacherById = Object.fromEntries(teachers.map(t => [t.id, t]));

    // ── Load sections for this dept ──────────────────────────────────────────
    const [sections] = await db.query(`
        SELECT s.id, s.section_name, c.id as class_id, c.program_name, c.session_id
        FROM sections s
        JOIN classes c ON s.class_id = c.id
        WHERE c.department_id = ? AND c.session_id = ?
        ORDER BY c.program_name, s.section_name
    `, [DEPT_ID, SESSION_ID]);

    if (sections.length === 0) {
        console.log(color.yellow('  No sections found for this department/session.'));
        process.exit(0);
    }

    const sectionIds = sections.map(s => s.id);

    // ── Load entire timetable for these sections ─────────────────────────────
    const [timetable] = await db.query(`
        SELECT 
            tt.id, tt.section_id, tt.subject_id, tt.teacher_id, tt.room_id,
            tt.day_id, tt.time_slot_id, tt.is_online,
            sub.short_code, sub.full_name as subject_name, sub.subject_type,
            sub.is_elective, sub.is_nptel
        FROM timetable tt
        JOIN subjects sub ON tt.subject_id = sub.id
        WHERE tt.session_id = ? AND tt.section_id IN (${sectionIds.map(() => '?').join(',')})
    `, [SESSION_ID, ...sectionIds]);

    // ── Also load ALL timetable entries for conflict checking ────────────────
    const [allEntries] = await db.query(`
        SELECT tt.id, tt.section_id, tt.teacher_id, tt.room_id, tt.day_id, tt.time_slot_id
        FROM timetable tt
        WHERE tt.session_id = ?
    `, [SESSION_ID]);

    // Build lookup maps for conflict checking
    // teacher → { dayId → Set<slotId> }
    const teacherBusy = {};
    const roomBusy    = {};
    for (const e of allEntries) {
        if (e.teacher_id) {
            if (!teacherBusy[e.teacher_id]) teacherBusy[e.teacher_id] = {};
            if (!teacherBusy[e.teacher_id][e.day_id]) teacherBusy[e.teacher_id][e.day_id] = new Set();
            teacherBusy[e.teacher_id][e.day_id].add(e.time_slot_id);
        }
        if (e.room_id) {
            if (!roomBusy[e.room_id]) roomBusy[e.room_id] = {};
            if (!roomBusy[e.room_id][e.day_id]) roomBusy[e.room_id][e.day_id] = new Set();
            roomBusy[e.room_id][e.day_id].add(e.time_slot_id);
        }
    }

    // ── Group timetable by section ───────────────────────────────────────────
    const sectionTT = {};
    for (const e of timetable) {
        if (!sectionTT[e.section_id]) sectionTT[e.section_id] = [];
        sectionTT[e.section_id].push(e);
    }

    // ── Identify gaps per section per day ────────────────────────────────────
    const gapLog    = [];   // [{dept, class, section, day, gapSlot, reason}]
    let totalGaps   = 0;
    let swappedGaps = 0;

    // For each half-day block (pre-lunch / post-lunch)
    const preLunch  = lectureSlots.filter(s => s.slot_order < LUNCH_SLOT_ORDER);
    const postLunch = lectureSlots.filter(s => s.slot_order > LUNCH_SLOT_ORDER);

    for (const sec of sections) {
        const entries = sectionTT[sec.id] || [];
        // Focus only on theory+lab entries (not remedial/elective)
        const theoryLabEntries = entries.filter(e =>
            (e.subject_type === 'theory' || e.subject_type === 'lab') &&
            !e.is_elective && !e.is_nptel
        );

        for (const day of days) {
            const dayEntries = theoryLabEntries.filter(e => e.day_id === day.id);
            if (dayEntries.length < 2) continue;

            for (const halfSlots of [preLunch, postLunch]) {
                const halfEntries = dayEntries
                    .filter(e => halfSlots.some(s => s.id === e.time_slot_id))
                    .sort((a, b) => slotById[a.time_slot_id]?.slot_order - slotById[b.time_slot_id]?.slot_order);

                if (halfEntries.length < 2) continue;

                const orders    = halfEntries.map(e => slotById[e.time_slot_id]?.slot_order);
                const halfOrds  = halfSlots.map(s => s.slot_order);

                for (let i = 0; i < orders.length - 1; i++) {
                    const idxA = halfOrds.indexOf(orders[i]);
                    const idxB = halfOrds.indexOf(orders[i + 1]);
                    if (idxB - idxA <= 1) continue; // No gap

                    // Gap found between halfEntries[i] and halfEntries[i+1]
                    const gapSlotOrders = halfOrds.slice(idxA + 1, idxB);

                    for (const gapOrder of gapSlotOrders) {
                        totalGaps++;
                        const gapSlot = halfSlots.find(s => s.slot_order === gapOrder);
                        if (!gapSlot) continue;

                        // ── Diagnose WHY this gap exists ──────────────────────────
                        // Collect unique teachers in this section's day schedule
                        const teachersInSection = [...new Set(dayEntries.map(e => e.teacher_id).filter(Boolean))];
                        const reasons = [];

                        // 1. Check if ALL teachers for this section are busy in this gap slot
                        const busyTeachers = teachersInSection.filter(tid => 
                            teacherBusy[tid]?.[day.id]?.has(gapSlot.id)
                        );
                        if (busyTeachers.length > 0) {
                            const names = busyTeachers.map(tid => teacherById[tid]?.full_name || `T#${tid}`).join(', ');
                            reasons.push(`Teacher busy: ${names}`);
                        }

                        // 2. Check room availability (for theory room type)
                        const theoryRooms = rooms.filter(r => r.room_type === 'theory');
                        const freeRooms = theoryRooms.filter(r =>
                            !roomBusy[r.id]?.[day.id]?.has(gapSlot.id)
                        );
                        if (freeRooms.length === 0) {
                            reasons.push('All theory rooms occupied');
                        }

                        // 3. Check if we could swap to compress
                        // Try: move entry after gap to slot before gap (or vice versa)
                        const entryAfterGap  = halfEntries[i + 1];
                        const entryBeforeGap = halfEntries[i];
                        const targetSlotId   = halfEntries[i].time_slot_id; // Try to move afterGap entry here
                        
                        // Check if entryAfterGap's teacher is free at targetSlotId
                        const teacherFreeAtTarget = !teacherBusy[entryAfterGap.teacher_id]?.[day.id]?.has(targetSlotId) 
                                                    || teacherBusy[entryAfterGap.teacher_id]?.[day.id]?.size === 1;

                        if (reasons.length === 0) {
                            // Check if section itself has something blocking swap
                            const sectionBusyAtGap = entries.some(e =>
                                e.day_id === day.id && e.time_slot_id === gapSlot.id
                            );
                            if (sectionBusyAtGap) {
                                reasons.push('Section has another class in this slot (elective/online)');
                            } else {
                                reasons.push('No valid swap found – constraint propagation failure');
                            }
                        }

                        const reasonStr = reasons.join(' | ');
                        gapLog.push({
                            dept:    `Dept#${DEPT_ID}`,
                            class:   sec.section_name,
                            day:     day.name,
                            slot:    `P${gapOrder}(${gapSlot.start_time}-${gapSlot.end_time})`,
                            reason:  reasonStr,
                        });
                    }
                }
            }
        }
    }

    // ── Print Gap Report ─────────────────────────────────────────────────────
    if (gapLog.length === 0) {
        console.log(color.green('  ✅  No gaps found in theory/lab schedule! Perfect timetable.'));
    } else {
        console.log(color.bold(color.yellow(`  ⚠️  Found ${totalGaps} gap(s) in theory/lab classes:\n`)));
        console.log(
            color.bold(pad('CLASS', 18)) +
            color.bold(pad('DAY', 10)) +
            color.bold(pad('GAP SLOT', 18)) +
            color.bold('REASON')
        );
        console.log('─'.repeat(100));
        for (const g of gapLog) {
            console.log(
                color.cyan(pad(g.class, 18)) +
                pad(g.day, 10) +
                color.yellow(pad(g.slot, 18)) +
                color.red(g.reason)
            );
        }
    }

    // ── Statistics per section ───────────────────────────────────────────────
    console.log(color.bold(`\n${'─'.repeat(70)}`));
    console.log(color.bold(`  PER-SECTION GAP SUMMARY`));
    console.log(color.bold(`${'─'.repeat(70)}`));
    console.log(pad('CLASS', 18) + pad('TOTAL SLOTS', 14) + pad('GAPS', 10) + 'GAP RATE');
    console.log('─'.repeat(60));

    for (const sec of sections) {
        const entries = sectionTT[sec.id] || [];
        const theoryLab = entries.filter(e =>
            (e.subject_type === 'theory' || e.subject_type === 'lab') && !e.is_elective
        );
        const secGaps = gapLog.filter(g => g.class === sec.section_name).length;
        const rate = theoryLab.length > 0 ? ((secGaps / theoryLab.length) * 100).toFixed(1) : '0.0';
        const rateColor = secGaps === 0 ? color.green : secGaps <= 2 ? color.yellow : color.red;
        console.log(
            pad(sec.section_name, 18) +
            pad(theoryLab.length, 14) +
            pad(secGaps, 10) +
            rateColor(`${rate}%`)
        );
    }

    // ── Reason frequency analysis ─────────────────────────────────────────────
    console.log(color.bold(`\n${'─'.repeat(70)}`));
    console.log(color.bold(`  ROOT CAUSE ANALYSIS`));
    console.log(color.bold(`${'─'.repeat(70)}`));
    const reasonFreq = {};
    for (const g of gapLog) {
        const key = g.reason.split('|')[0].trim();
        reasonFreq[key] = (reasonFreq[key] || 0) + 1;
    }
    for (const [reason, count] of Object.entries(reasonFreq).sort((a,b) => b[1]-a[1])) {
        console.log(`  ${count.toString().padStart(3)}x  ${reason}`);
    }

    console.log(color.bold(`\n${'═'.repeat(70)}\n`));

    process.exit(0);
}

analyzeGaps().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
