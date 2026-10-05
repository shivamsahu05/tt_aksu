# Timetable Generation Logic & Workflow

This document outlines the core logic, functions, and architecture used to generate the timetable in the application (accessible via `http://localhost:5173/admin/timetable`).

The backend timetable generation is primarily handled by three core components:
1. **`timetableController.js`**: The API entry point.
2. **`TimetableEngine.js`**: Context loader and transaction manager.
3. **`SchedulingStrategy.js`**: The core algorithmic brain.
4. **`ConflictEngine.js`**: The rule-validator.

---

## 1. Controller Layer (`timetableController.js`)
When a user clicks "Generate Timetable", the request hits `generateTimetable()`.
- **Authorization & Scope:** Checks if the user is a `SUPER_ADMIN` (full generation) or `DEPARTMENT_ADMIN` (department-scoped generation).
- **Audit Logging:** Logs the start of the generation process.
- **Delegation:** Calls `TimetableEngine.generate(session_id, options)`.

---

## 2. Engine Layer (`TimetableEngine.js`)
This class acts as the orchestrator for the generation process.

### `loadContext(sessionId)`
Before scheduling begins, it loads all necessary data into memory to minimize database hits during the heavy algorithmic loops:
- **Settings & Days/Slots:** Loads structural boundaries.
- **Teachers & Rooms:** Caches capacities, departments, and active statuses.
- **Sections & Allocations:** Loads all class sections and what subjects they need to be taught (Teacher -> Subject -> Section).
- **Dynamic Strength Estimation:** *[Newly Added]* If a section has `student_strength` as `0` or `null`, it dynamically estimates the strength by taking the average of other sections in the same program (e.g., 3rd & 5th BTech average applied to 1st BTech).

### `generate(sessionId, options)`
- Initiates a database transaction.
- If `overwrite=true`, it safely **archives** the existing timetable for the scope (changes `status = 'archived'`). This ensures historical versions are never deleted and can be securely restored later by admins.
- Calls `SchedulingStrategy.GreedyHeuristicStrategy(context)`.
- Saves the generated results back to the database.

---

## 3. Algorithmic Layer (`SchedulingStrategy.js`)
This is where the actual puzzle-solving happens. The algorithm uses a **Scored Greedy Heuristic** approach with post-processing compaction.

### Step 3.1: Building Blocks (`buildBlocks`)
The engine organizes raw allocations into "Blocks" (units of scheduling):
- **Standalone Classes:** Standard 1-to-1 mappings.
- **Merged Classes (Shared Subjects):** If multiple sections are merged for a subject (e.g., a common lecture), they are bundled into a single block (`isShared: true`). They will be assigned **one large room**.
- **Merged Classes (Split Subjects / Parallel Blocks):** *[Newly Added]* If sections in a merged group have different subjects (e.g., Electives with different teachers), they are packed into "Parallel Blocks". This forces the engine to schedule them in the **exact same time slot** but assigns them to **different rooms** based on their individual strengths.

### Step 3.2: Prioritization & Sorting
Blocks are sorted so the hardest ones are scheduled first:
1. **Lab Classes:** Hardest to fit because they require consecutive slots (2-3 periods).
2. **Merged/Shared Classes:** Hard because they require large rooms and lock multiple sections.
3. **Teacher Workload:** Blocks taught by teachers with high workloads are prioritized.

### Step 3.3: Finding Valid Slots & Scoring
For each block, the engine scans all available Days and Slots. It doesn't just pick the first free slot; it **scores** them using several factors:
- **Teacher Daily Load:** Exponentially penalizes slots that would make a teacher work too many classes in a single day (e.g., `Math.pow(2, dailyLoad)`). This ensures teachers get a balanced week instead of 5 classes on Monday and 0 on Tuesday.
- **Section Daily Load:** Prevents students from having too many consecutive classes.
- **Lab Adjacency:** Specifically tries to find consecutive slots for labs.

### Step 3.4: Room Allocation (`findRoom`)
Once a valid time slot is found, it finds a room:
- **Type Matching:** Lab classes only get Lab rooms; Theory gets Theory rooms.
- **Capacity Matching:** Sorts rooms by capacity (ascending) and picks the smallest room that fits the `student_strength`. This prevents a class of 20 students from locking up a 100-seater auditorium.
- **Department Preference & Lab Isolation:** Theory classes prioritize rooms belonging to the same department. Lab classes are **strictly isolated**—they will only be scheduled in labs explicitly assigned to their department, gracefully failing if no department lab is available to prevent resource stealing.
- **Explicit Room Overrides:** If a specific `room_id` was bound during the Subject Allocation phase, the engine strictly bypasses capacity matching and locks the class into that specific room.

### Step 3.5: Post-Processing Compaction
Because the greedy algorithm leaves random empty gaps (free periods) in a student's day, two cleanup functions run:
1. **`packLeft()`:** Shifts classes as early in the day as possible to avoid late-afternoon single classes.
2. **`resolveGaps()`:** Specifically identifies 1-period gaps (e.g., Class at Slot 1, Free at Slot 2, Class at Slot 3) and tries to pull Slot 3 into Slot 2 to create continuous schedules.

---

## 4. Validation Layer (`ConflictEngine.js`)
Every single placement attempt is strictly verified against hard constraints:
- **Teacher Double-Booking:** A teacher cannot be in two rooms at once.
- **Section Double-Booking:** A section cannot take two subjects at once.
- **Room Double-Booking:** A room cannot host two classes at once.
- **Consecutive Limits:** Checks if assigning this slot breaches the "Max consecutive classes without a break" rule.
- **Credit Limits:** Ensures a subject is not scheduled more times in a week than its defined `L/T/P` credits allow.

## Summary Workflow
1. Load Data & Estimate Missing Strengths -> 2. Build & Parallelize Blocks -> 3. Sort by Difficulty -> 4. Score Slots for Balance -> 5. Assign Rooms by Capacity -> 6. Validate Constraints -> 7. Compact Gaps -> 8. Save to DB.



======================
Better solution

Greedy → Gap Detection → Intelligent Repair/Relocation → Room Optimization → Re-score → Repeat for limited iterations → Best timetable retain karo.

Isliye objective ye nahi hona chahiye:

❌ "Zero gaps at any cost"

Objective hona chahiye:

✅ "Minimum possible gaps while preserving all hard constraints."


===============================================
===============================================


Timetable Gapping Problem — Possible Solutions
1. Sabse pehle Gap ko Properly Detect Karo
Abhi kya ho raha hai?

Aapke paas packLeft() aur resolveGaps() already hain, lekin ho sakta hai gap detection sirf immediate pattern dekh raha ho:

Slot 1 → Class
Slot 2 → FREE
Slot 3 → Class

Isse zyada complex situation miss ho sakti hai.

Kya karna hai?

Har section ka complete daily schedule analyse karo:

9  → Maths
10 → Physics
11 → FREE
12 → DBMS
1  → FREE
2  → AI

Ismein actual internal gaps:

11
1

hain.

Lekin:

8  → FREE
9  → Maths
10 → Physics
11 → DBMS

mein 8 ko gap nahi maana jaana chahiye.

Result

Pehle system ko clearly pata chalega:

Kaunsa free period actual problematic gap hai aur kaunsa normal empty period hai.

2. Gap Count Ko Timetable Score Mein Add Karo
Abhi kya ho raha hai?

Aapka scheduler mainly:

Teacher load
Section load
Consecutive classes
Lab adjacency

ko score kar raha hai.

Lekin timetable mein gap banne par uska enough penalty nahi ho raha.

Kya karna hai?

Score mein add karo:

Internal Gap Penalty

Example:

No gap        → 0 penalty
1 gap         → +50
2 gaps        → +100
3 gaps        → +150

Exact numbers testing se tune karne hain.

Result

Scheduler ke saamne do valid options honge:

Option A → 1 gap
Option B → 0 gap

To woh Option B ko prefer karega.

Ye sabse important change hai.

3. Gap Create Karne Wale Slot Ko Penalize Karo

Ye Point 2 se bhi better hai.

Problem

Maan lo:

9  → Maths
10 → Physics
11 → FREE
12 → DBMS

DBMS ko Slot 12 mein daalne ke time algorithm ko future gap ka idea nahi tha.

Kya karna hai?

Jab candidate slot check ho, temporarily class place karke dekho:

Before:
9  A
10 B
11 FREE
12 C


Candidate:
C → 11

New schedule:

9  A
10 B
11 C
12 FREE

Gap reduce hua.

To candidate ko reward:

Gap reduction = GOOD

Agar candidate gap create karta hai:

Gap increase = BAD
Result

Scheduler sirf:

"Slot free hai?"

nahi sochega.

Balki:

"Is slot mein class daalne ke baad timetable better hoga ya worse?"

socchega.

4. resolveGaps() Ko Sirf One-Move Function Mat Rakho
Abhi kya ho raha hai?

Likely:

Slot 3 → Slot 2

try hota hai.

Agar directly possible nahi:

Can't move

aur function ruk jaata hai.

Problem

Kabhi class ko directly move nahi kar sakte, lekin swap karke gap solve ho sakta hai.

Kya karna hai?

resolveGaps() mein:

1. Direct Move
2. Swap
3. Room Reassignment
4. Cross-Day Move

try karvao.

Result

Gap solve hone ke chances kaafi increase honge.

5. Direct Move

Ye sabse simple repair hai.

Example:

9  → Maths
10 → Physics
11 → FREE
12 → DBMS

Check:

DBMS 12 → 11 ?

Agar:

Teacher free
Section free
Room available
Credit okay
Lab constraint okay

to move kar do.

Result:

9  → Maths
10 → Physics
11 → DBMS
12 → FREE
6. Same-Day Swap

Agar direct move possible nahi hai, swap try karo.

Example:

CSE 1A


9  → A
10 → B
11 → FREE
12 → C

Agar C → 11 possible nahi hai, lekin kisi doosri compatible class ko shift karke C ko 11 mil sakta hai, to swap try karo.

Concept:

A ↔ B

ya:

Class C ↔ Class D

Har swap ke baad ConflictEngine se validate karna mandatory hai.

Result

Direct movement se jo gaps solve nahi hote, woh swaps se solve ho sakte hain.

7. Room Reassignment Use Karo

Ye aapke system mein kaafi useful solution ho sakta hai.

Example

Gap:

11 → FREE
12 → DBMS

DBMS ko 11 par jaana hai.

Lekin:

Room 101 → occupied

Ho sakta hai koi doosra suitable room:

Room 102 → FREE

available ho.

To:

DBMS
12 PM Room 101
       ↓
11 AM Room 102

possible ho sakta hai.

Kya karna hai?

Gap resolver ko allow karo:

Class ka room change karke class ko gap slot mein shift karna.

Important

Room type/capacity validate honi chahiye.

8. Same Building Ke Rooms Ka Use Karo — But Correctly

Aapka idea:

"Same building ke doosre room mein shift kar dein?"

Haan, ye useful hai.

Example:

Building A


Room 101 → 40 capacity
Room 102 → 60 capacity
Room 103 → 100 capacity

Class strength:

35

Agar Room 101 unavailable hai, Room 102 use ho sakta hai.

Lekin

Different classes ko same room/time mein mat daalo.

Galat:

10 AM


Room 101:
Maths + Physics

Sahi:

10 AM


Maths → Room 101
Physics → Room 102

Ya genuine shared class ho to:

Maths
CSE 1A + CSE 1B
Room 101
9. Shared Classes Ko Atomic Block Rakho

Agar:

CSE 1A + CSE 1B
Mathematics
Same Teacher

shared class hai, to gap repair mein isko todna nahi chahiye.

Treat as:

SharedBlock

Aur poora block move karo:

Monday 10
      ↓
Tuesday 11
Result

Shared classes ki consistency nahi tootegi.

10. Parallel Blocks Ko Same Time Preserve Karo

Example:

CSE 3A → AI → Teacher A → Room 101
CSE 3B → Cloud → Teacher B → Room 102

Agar ye parallel block hai, to time same hona chahiye.

Move:

Monday 11
      ↓
Tuesday 10

to:

AI    → Tuesday 10
Cloud → Tuesday 10

dono move honge.

Rooms alag rahenge.

11. Chain Move Add Karo

Ye gap solving ka powerful solution hai.

Problem
9  → A
10 → B
11 → FREE
12 → C

C ko 11 par directly nahi la sakte.

Lekin:

C → 11

ke liye kisi doosri class ko move karna possible hai.

Example:

D → 11

room occupy kar raha hai.

D ko:

13

shift kar sakte ho.

Then:

C → 11
D → 13
Kya karna hai?

Repair engine ko 2–3 level tak chain search karne do.

A move
 ↓
B move
 ↓
C move
Important

Unlimited chain search mat karna.

Maximum:

depth = 2 or 3

rakho.

12. Cross-Day Move

Kabhi same day gap solve nahi hota.

Example:

Monday


9  → Maths
10 → Physics
11 → FREE
12 → DBMS

Agar DBMS Monday 11 par impossible hai, check karo:

Tuesday 10
Tuesday 11
Tuesday 12

Kya DBMS Tuesday shift ho sakta hai?

Agar haan, Monday ka gap kisi aur class se fill ho sakta hai.

Result

Algorithm ko sirf same day mein locked nahi rehna padega.

13. Lekin Cross-Day Move Ko Blindly Allow Mat Karo

Cross-day move se doosre day ka timetable kharab ho sakta hai.

Isliye move ke baad:

Old Score
vs
New Score

compare karo.

Example:

Before:
Monday gap = 1
Tuesday gap = 0
Total = 1


After:
Monday gap = 0
Tuesday gap = 2
Total = 2

To move reject.

14. packLeft() Ko Improve Karo
Current idea

Classes ko early slots mein shift karna.

Problem

Agar blindly earliest slot choose kiya, to doosre side gaps ban sakte hain.

Better logic

packLeft() ko:

"Earliest possible slot"

ke bajaye:

"Earliest slot that improves the overall timetable score"

choose karna chahiye.

Example:

Slot 2 → score 50
Slot 3 → score 10

Agar Slot 3 overall timetable ke liye better hai, to Slot 3 choose karo.

15. resolveGaps() Ko Baar-Baar Chalao — But Controlled Way Mein

Aapka idea correct hai, bas implementation safe honi chahiye.

Galat:

while (gap > 0) {
    resolveGaps();
}

Kyunki infinite loop ho sakta hai.

Better:
Maximum 20/50/100 iterations

Example:

Iteration 1 → 15 gaps
Iteration 2 → 11 gaps
Iteration 3 → 8 gaps
Iteration 4 → 5 gaps
Iteration 5 → 5 gaps

Agar improvement nahi aa raha:

STOP
16. Best Timetable Save Karo

Ye iterative solution ke saath mandatory hai.

Example:

Attempt 1 → 20 gaps
Attempt 2 → 15 gaps
Attempt 3 → 10 gaps
Attempt 4 → 12 gaps

Attempt 4 ko final mat karo.

Best:

Attempt 3 → 10 gaps

save rakho.

Logic:
if (newScore < bestScore) {
    bestTimetable = clone(currentTimetable)
    bestScore = newScore
}
17. Gap Repair Mein Sirf Gap Count Mat Dekho

Ye important hai.

Example:

Timetable A
2 gaps

but:

Teacher workload balanced
No late classes
No consecutive problem
Timetable B
1 gap

but:

Teacher has 7 classes Monday
Student has 6 consecutive classes

Timetable B necessarily better nahi hai.

Isliye final score combined hona chahiye:

Gap
+
Teacher Load
+
Section Load
+
Consecutive Classes
+
Late Periods
+
Room Utilization
18. Ruin & Recreate — Jab Normal Repair Fail Ho

Agar kisi section ka timetable bahut kharab hai:

9  → A
10 → B
11 → FREE
12 → C
1  → FREE
2  → D

aur individual moves fail ho rahe hain, to:

Step 1

Us section ki classes temporarily remove karo.

Step 2

Us section ko dobara schedule karo.

Step 3

Is baar current timetable ke remaining constraints ko consider karo.

Step 4

New version ka score compare karo.

Agar better:

Accept

otherwise:

Rollback
19. Sirf Problematic Sections Ko Recreate Karo

Pure timetable ko baar-baar regenerate mat karo.

Pehle identify:

CSE 1A → 3 gaps
CSE 2B → 2 gaps
ECE 3A → 2 gaps

Then sirf inko repair/recreate karo.

Benefit

Performance bhi manageable rahegi.

20. Multiple Complete Attempts

Agar algorithm ka initial greedy decision hi poor hai, repair se bhi problem aa sakti hai.

Isliye final option:

Generate Attempt 1
Generate Attempt 2
Generate Attempt 3
Generate Attempt 4
Generate Attempt 5

Har attempt mein slight variation:

block ordering
equal-score slot selection
room preference

rakho.

Then:

Attempt 1 → Score 900
Attempt 2 → Score 750
Attempt 3 → Score 680
Attempt 4 → Score 820
Attempt 5 → Score 700

Final:

Attempt 3
21. Labs Ko Normal Class Ki Tarah Repair Mat Karo

Agar:

Programming Lab
10-11
11-12
12-1

hai, to isko individual classes nahi samjho.

Isko ek block:

[10,11,12]

samjho.

Move karna ho to:

[10,11,12]
        ↓
[1,2,3]

poora block move karo.

22. Hard Constraints Ko Kabhi Break Mat Karna

Gap solve karne ke chakkar mein ye kabhi compromise nahi hone chahiye:

❌ Teacher double booking
❌ Section double booking
❌ Room double booking
❌ Room capacity violation
❌ Theory class in lab-only room
❌ Lab consecutive requirement break
❌ Credit limit violation

Ye absolute rules hain.

23. Soft Constraints Ko Optimize Karo

Ye improve kiye ja sakte hain:

Gap
Teacher daily load
Section daily load
Late class
Room utilization
Department room preference
Consecutive classes

Matlab:

Hard constraint = "Allowed hai ya nahi?"

Soft constraint = "Allowed hai, lekin kitna achha hai?"

Ye distinction aapke algorithm ko bahut better bana sakti hai.

24. Ek Proper TimetableQualityScore Banao

Final timetable ko ek score do.

Example concept:

Total Score =
    Internal Gaps
  + Teacher Gaps
  + Teacher Overload
  + Section Overload
  + Consecutive Penalty
  + Late Slot Penalty
  + Room Waste

Jitna score kam, timetable utna better.

Example:

Timetable A = 450
Timetable B = 280
Timetable C = 320

Best:

B
25. Unavoidable Gap Mark Karo

Kabhi gap mathematically/ practically avoid nahi hoga.

Example:

Teacher A available only:
Monday 9
Monday 12

aur section ki classes:

9 → A
12 → B

To:

10,11

ka gap ho sakta hai.

Aise gap par algorithm endlessly search na kare.

Agar 20–30 valid repair attempts fail ho gaye:

mark as unavoidable
Result

Algorithm time waste nahi karega.

26. Final Gap Report Banao

Generation ke baad internal report:

Total Sections: 50


0 Gap:
40 Sections


1 Gap:
7 Sections


2 Gaps:
2 Sections


Unavoidable:
1 Section

Aur saath mein:

Teacher Conflicts: 0
Room Conflicts: 0
Section Conflicts: 0
Credit Violations: 0

Isse aapko pata chalega ki algorithm actually improve ho raha hai ya nahi.

27. Sab Solutions Ko Priority Ke According Implement Karo

Main aapko ye exact order recommend karunga:

🟢 Phase 1 — Sabse pehle ye karo

1. Proper Gap Detection

↓

2. Gap Penalty Score

↓

3. Gap Reduction Reward

↓

4. Improved packLeft()

↓

5. Improved resolveGaps()

Ye relatively easy changes hain.

🟡 Phase 2 — Uske baad

6. Room Reassignment

↓

7. Same-Day Swap

↓

8. Cross-Day Move

↓

9. Shared/Parallel Block ko atomic rakho

🟠 Phase 3 — Advanced

10. Chain Move

↓

11. Ruin & Recreate

↓

12. Limited Iterative Repair

🔴 Phase 4 — Final Optimization

13. Multiple Generation Attempts

↓

14. Best Score Timetable Select

↓

15. Unavoidable Gap Detection

↓

16. Final Validation + Report

🏆 Mere hisaab se aapke system mein sabse effective combination

Aapko ek hi solution choose karne ki zarurat nahi hai. Best result combination se aayega:

                 GREEDY SCHEDULER
                       ↓
              GAP-AWARE SCORING
                       ↓
                  packLeft()
                       ↓
                resolveGaps()
                       ↓
               DIRECT MOVE
                       ↓
                   SWAP
                       ↓
             ROOM REASSIGNMENT
                       ↓
               CROSS-DAY MOVE
                       ↓
                CHAIN MOVE
                       ↓
             CONFLICT VALIDATION
                       ↓
                 SCORE AGAIN
                       ↓
              BETTER? ──── NO → Reject
                 │
                YES
                 ↓
               Accept
                 ↓
          Repeat Limited Times
                 ↓
           Still Bad Section?
                 ↓
          RUIN & RECREATE
                 ↓
       Multiple Attempts (optional)
                 ↓
           BEST TIMETABLE
⭐ Agar aapko practical implementation priority chahiye

Sabse pehle TimetableQualityScore + Gap Detection + Improved resolveGaps() karo.

Uske baad Room Reassignment + Swap add karo.

Uske baad Chain Move.

Aur agar phir bhi gaps bach rahe hain, Ruin & Recreate + Multiple Attempts lagao.

Mere according sirf resolveGaps() ko baar-baar chalana main solution nahi hai. Better solution ye hai ki algorithm har move ke baad timetable ka overall score calculate kare aur sirf improvement accept kare. Isse timetable gradually better hota rahega aur algorithm kisi gap ko solve karte hue doosra bada problem create karke wapas nahi aayega.



=====================================================
====================================================

