# TTMS - Features & Capabilities

This document provides a comprehensive overview of the advanced features, logic, and capabilities built into the Timetable Management System (TTMS). It is intended for testers, QA engineers, clients, and end-users to understand the depth of functionality provided by the system.

## 1. Advanced Subject & Class Management

### Section-Wise Subject Allocation
Unlike traditional systems that lock subjects to an entire course/program, TTMS allows for extreme granularity. You can assign completely different subjects, electives, or laboratories on a strict *section-by-section* basis. For example, Section A could study "Advanced Python" while Section B studies "Java".

### L-T-P (Lecture, Tutorial, Practical) Structure
The system fully supports the standard L-T-P academic structure. It distinguishes between Theory classes and Laboratory sessions, ensuring that:
* Theory classes are assigned standard classrooms.
* Practical/Lab classes are strictly assigned to designated Laboratory rooms.
* Lab classes are scheduled in contiguous, uninterrupted blocks based on their credit weighting.
* **Smart Credit Workload Segregation:** The allocation engine correctly splits `l_credit` (Theory) and `p_credit` (Practical) when calculating a teacher's workload, preventing tutorial credits from artificially inflating theory teacher workloads.

### Merged / Combined Sections
The system intelligently handles scenarios where multiple sections study together.
* **Shared Subjects:** The timetable engine groups these sections together, schedules them in a single large room, and visually represents this on the Daily Report and Timetable Manager without creating conflicting UI clutter.
* **Theory Synchronization:** If merged sections have *different* independent subjects (e.g. BCA vs Cyber), the engine aggressively syncs their independent theory classes to run in the same time slot (in different rooms). This guarantees classes run perfectly in parallel, preventing one section from studying while the other sits idle in the Library.

### Online Classes
Subjects or classes flagged as "Online" bypass physical room requirements. The scheduler will successfully allocate time and teachers for these classes without unnecessarily consuming physical campus infrastructure.

### Active/Inactive Class Management
Classes can be individually toggled as Active or Inactive.
* **Historical Data Retention:** When a semester ends, classes can be marked inactive. They are instantly filtered out of the live Timetable allocations, selections, and matrix views without losing the underlying historical assignment records.
* **Bulk Upload Handling:** Classes imported via bulk upload template default to Active for seamless onboarding, but can be manually deactivated at any time.

---

## 2. Granular Role-Based Access Control (RBAC)

TTMS supports three core user roles: **Super Admin**, **Department Admin (HOD)**, and **Faculty**.
Beyond these core roles, the system offers advanced, modular permission delegation.

### Faculty Delegations
Administrators can grant individual Faculty members specific management privileges without elevating them to full Department Admins. Available module delegations include:
* **Manage Subjects:** Faculty can create and assign subjects for their department.
* **Manage Classes:** Faculty can organize sections and curriculum.
* **Manage Rooms:** Faculty can allocate and supervise department rooms.
* **Manage Leaves:** Faculty can approve or reject teacher leave applications.
* **Internal Tests:** Faculty can schedule and analyze department-wide internal exams.

Delegated operations seamlessly appear in the Faculty's dashboard under distinct "Delegated Master Data" and "Delegated Operations" menus.

---

## 3. Dynamic Teacher Constraints

### Primary and Secondary Departments
To support inter-departmental teaching (e.g., a Mathematics professor teaching engineering students), teachers can be assigned to one **Primary Department** and multiple **Secondary Departments**.
* **Impact:** The system aggregates the teacher's workload and schedule across *all* their departments, guaranteeing they are never double-booked across the university.

### Teacher Availability Constraints
Administrators can define specific "Not Available" time blocks for any teacher.
* **Mechanism:** During automated timetable generation, the engine's constraint solver checks the teacher's availability profile and will strictly bypass slots where the teacher is unavailable.

---

## 3. Intelligent Scheduling & Automation

### Automated Timetable Generation Algorithm
The core engine utilizes a multi-phase, constraint-satisfaction algorithm:
1. **Hard Constraints:** Prevents teacher clashes, prevents room double-booking, and honors teacher availability.
2. **Soft Constraints:** Attempts to distribute workload evenly across the week and avoid large gaps between classes for students.
3. **Lab Blocking:** Schedules lab sessions in continuous multi-hour blocks.

### Smart Room Allocator
Instead of manually guessing which room fits which class, the **Smart Allocator** automates the process:
* **Capacity and Scope Parsing:** The engine automatically finds rooms that fit the exact student strength for a given section/subject combination.
* **Smart Floating Rooms:** When default rooms are occupied, the system seamlessly floats to other available valid spaces based on class size.
* **Strict Lab Department Isolation:** Lab assignments strictly adhere to department boundaries (e.g., Computer Science sections will only ever be placed in CS labs). If a department's lab capacity is full, the engine safely skips scheduling rather than stealing a cross-department lab.
* **Explicit Room Overrides:** If an administrator explicitly overrides and assigns a specific `room_id` during the subject allocation phase, the engine will forcefully respect that choice and allocate the exact requested room.
* **Smart Shared Lab Processing:** If sections in a merged group share the same lab subject (e.g. "Computer Networks"), their strengths are mathematically combined so the algorithm can search for a single, large-capacity laboratory to fit everyone.
* **Section-Specific Labs:** If sections in a merged group have distinct lab subjects, they are automatically separated in the UI to allow granular, section-by-section lab assignments.
* **Clean Section Naming:** Hides redundant "A" sections and elegantly auto-formats subsequent sections ("B1", "B2") for cleaner reports and dashboards.
* It assigns the optimal room without conflicts.

### Mandatory Remedial Classes
The system enforces a strict rule: **Every single section must have exactly one "Remedial Class" scheduled per week.**
* **Fail-Safe Mechanism:** If a specific class teacher is not explicitly assigned to a section, the system automatically injects a dummy `CT` (Class Teacher) placeholder. This guarantees the Remedial Class constraint is satisfied and generation never fails due to missing teacher data.

---

## 4. Bulk Data Processing & AI

### Fuzzy Logic Matching for Excel Uploads
When uploading large batches of Master Data (Subjects, Teachers, Classes) via Excel or CSV, users often make minor typographical errors.
* **Mechanism:** The system employs advanced **Fuzzy Logic** text matching. If the database expects `AI/DS` but the Excel sheet says `AIDS` or `AI-DS`, the system algorithmically calculates the string similarity and smartly matches the entities without throwing generic upload errors.

---

## 5. Analytics & Daily Operations

### Deep Timetable Analysis
Administrators have access to a rich analytical suite *before* deploying a timetable:
* Detailed breakdown of how many Total Credits are fulfilled.
* Warning logs outlining exactly which classes and sections are missing assigned teachers.
* Suggestions on how many classes a teacher must cover daily to maintain parity.

### Timetable Archiving and Restoration
Timetables are fully version-controlled to ensure strict data security:
* **Archiving:** When a new timetable is generated, the old one is safely archived, never deleted.
* **Historical View:** Administrators can open a "View History" modal to browse previously generated timetables, complete with entry counts and dates.
* **Safe Restoration:** Admins can view an archived timetable grid in read-only mode, and safely restore/reactivate it with a single click, instantly syncing the entire department back to the previous stable state.
* **Department-Wise Scope Inheritance:** The Timetable Reports and Analysis dashboards intelligently remember and inherit department selections from your Timetable views, eliminating redundant filter selections.
* **Hidden Slots Toggling:** Keep master timetable views clean by instantly hiding or revealing unallocated breaks and empty periods via a simple UI toggle.
* **Free Rooms Finder:** Allows administrators to select any specific Day and Time Slot to instantly view a list of all completely unoccupied rooms. Room lists explicitly display their assigned department short code for clarity.
* **Room Occupancy Matrix:** A visual heatmap displaying every room as a row and every slot as a column. Cells are colored green (Free) or red (Occupied). Hovering over an occupied cell reveals exactly which class and subject is utilizing the space.

### Intelligent Substitute / Replacement Suggestions
When a teacher applies for leave and is marked absent, the **Daily Timetable** flags their scheduled classes for the day.
* **Auto-Suggest:** HODs can click "Suggest Substitute" and the system will instantly query the database to find other teachers within the same department who are completely free during that exact time slot.
* **Real-Time Sub-row Engagement Status Tracking:** In the Daily Timetable Matrix, every scheduled class cell features an italicized sub-row (`↳ Status / Engagement`) showing real-time teacher engagement:
  * `[ENGAGED] <Substitute Teacher Name>` in green for classes covered by an assigned substitute.
  * `[ON LEAVE - UNASSIGNED]` in soft rose-red for classes where the teacher is absent and no substitute is assigned yet.
  * `[SCHEDULED]` in green for regular scheduled classes.
* **Intelligent Substitute Engagement Engine:** Automatically maps both leave-based teacher absences and ad-hoc / event-based absent teacher engagements to substitute teachers with immediate real-time reflection across the web UI and Excel exports using database `COALESCE(l.teacher_id, tt.teacher_id)` queries.

### Clean Academic & Batch Section Naming
* Automatically displays clean, concise single-section names (e.g., `BCA (H) Sem 1`) without trailing `- A` or `(A)`.
* For multi-section programs, formats batches cleanly as `BCA (H) AI/ML Sem 3 B1`, `B2`, `B3` without redundant alphabetical characters across both web UI tables and exported reports.

### Professional Excel Matrix Reports (`xlsx-js-style`)
* **True Excel Cell Styling:** Exported `.xlsx` reports preserve rich corporate color palettes, custom `Calibri` fonts, borders, and automatic cell wrapping.
* **Subtitle Ribbon & Download Timestamp:** Incorporates a Navy Blue Title Banner (`#1E3A8A`) and a light-blue Subtitle Ribbon (`#EFF6FF`) displaying Department name, Timetable Date, and the exact **Download Timestamp (`Downloaded At: DD/MM/YYYY, HH:MM:SS AM/PM`)** merged across grid columns.
* **Visual Color Coding in Excel:** Mint Green (`#D1FAE5`) for Engaged Substitutes, Rose Red (`#FEE2E2`) for Unassigned On-Leave classes, Warm Yellow (`#FEF08A`) for Lunch Breaks, and Soft Gray (`#F3F4F6`) for class label headers.

---

## 6. Allocation Template & Elective Subject Handling

### Smart Template Download with Elective Preview Popup
Before downloading the Allocation Template CSV, the system displays an informative popup:
* **About This Template** section explains the structure: regular subjects always appear; elective subjects only appear if explicitly selected for each class under *Classes → Edit → Available Elective Subjects*.
* **Green section (✅):** Lists every class that has elective subjects selected — these will appear in the template.
* **Orange warning section (⚠️):** Lists classes where elective subjects exist but none have been selected — with clear guidance to fix this via *Classes → Edit*.
* **No electives scenario:** If no elective subjects exist in the department, a clean informational note is shown.
* Users must confirm before the template downloads, preventing silent omissions.

### Accurate Theory & Lab Credit Split in Template
The Allocation Template CSV now shows the correct credit value for each allocation type row:
* **Theory (Lecture) rows** show `l_credit` (Lecture credits only).
* **Lab (Practical) rows** show `p_credit` (Practical credits only).
* Previously, both rows incorrectly showed `total_credits`, causing confusion about workload per teacher.

### Precise Elective-to-Class Matching
The elective subject preview (popup) and template generation both match elective subjects to classes using **semester + program_name** (normalized fuzzy match), not just semester:
* An elective with `program_name = "BTech CSE"` only appears for **BTech CSE** classes of the matching semester — not for all semester-5 classes across other programs.
* Elective subjects with no `program_name` are treated as global (apply to all classes of that semester).


---

## 8. Timetable Generation Intelligence

### Gap-Free Scheduling (Gravity Model)
The scheduler natively treats the entire day as a continuous block (eliminating the old AM/PM split logic) to detect and resolve cross-lunch gaps.
* **Phase 1 – Multi-Strategy Resolution:** Implements a deep 9-stage resolution algorithm that evaluates Same-Day Swaps, Cross-Day Moves, Room Reassignments, Chain Moves, and Ruin & Recreate logic to fix existing internal holes in the schedule.
* **Phase 2 – Merged Class Gap Mitigation:** Accurately targets merged class blocks to natively identify and reduce shared gaps among combined groups.
* **Lab Pair Safety:** Lab blocks (2 consecutive slots) are moved only as an atomic unit to adjacent consecutive slots to preserve the required 2-hour continuity.

### Balanced Teacher Workload Across 6 Days
The scheduler actively distributes each teacher's load evenly across the full working week.
* A `Teacher Day Balance Score` is computed for both theory and lab placement phases. Days where the teacher already has many classes are de-prioritized, avoiding the pattern of Monday–Tuesday overload with empty later days.

### Remedial Class Teacher Availability
When scheduling the mandatory weekly Remedial Class, the engine checks the class teacher's availability across three layers:
1. **New session entries** — the teacher must not already be assigned in the same slot elsewhere in this generation.
2. **Pre-existing DB timetable** — checks active timetable rows already in the database so teachers in multi-department roles are not double-booked.
3. **Teacher preferences** — hard `unavailable` blocks in the teacher's preference profile are strictly enforced.
4. **Max daily load** — if the teacher has already reached their maximum daily class limit, the slot is skipped.

### 10-Second AI Analysis Popup on Generation
When initiating timetable generation or regeneration, a rich animated progress popup appears for ~10 seconds, showing real-time analysis steps (Fetching Allocations → Resolving Conflicts → Optimizing Rooms → Finalizing Schedule) to give visual feedback that the engine is performing deep analysis before committing the result to the database.


### Session-Based Authentication (Browser-Close = Auto Logout)
* **Admin & Super Admin:** Auth cookies are issued as **session cookies** (no `maxAge`). The moment the browser window is closed or the system restarts, the cookie is automatically cleared by the browser and the user must re-login with username, password, and OTP verification.
* **Zero persistent login:** There is no grace period for administrative accounts — re-authentication is mandatory every session.
* **Cross-origin support:** In production, cookies use `sameSite: 'none'` with `secure: true` to support cross-origin deployments (e.g., hosted domains), while development uses `sameSite: 'strict'` for local security.



### Recent Updates (Internal Tests Module)
- **Multi-Subject/Multi-Room Scheduling**: Schedule multiple subjects in the same time slot across multiple rooms (Theory & Lab).
- **Consolidated Overview**: Same-class tests are grouped into a single view in the Overview Table automatically.
- **Smart Print & PDF Generation**: 
  - Dynamic interactive selection to 'Include Invigilators' or print without them.
  - Automatically merges identical class rows into grouped headers.
  - Generates 'Invigilators Legend' showing Name, Initial, and Employee ID.
- **Advanced Invigilator Logic**: Distinct assignment for Lab vs Theory Invigilators.
- **Direct Table Actions**: Print notices and PDFs directly from the Overview table without opening View Modals.
