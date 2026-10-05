# Timetable Management System - Comprehensive User Manual

Welcome to the **Timetable Management System**. This document serves as a complete, step-by-step guide for any new user or administrator to understand how the system works, what every page does, and the exact sequence of steps required to generate a fully functioning timetable.

---

## Table of Contents
1. [Understanding User Roles](#1-understanding-user-roles)
2. [Step-by-Step System Setup (Where to Start)](#2-step-by-step-system-setup-where-to-start)
3. [Page-by-Page Feature Guide](#3-page-by-page-feature-guide)
4. [Daily Operational Workflow](#4-daily-operational-workflow)

---

## 1. Understanding User Roles

The system is divided into three levels of access to ensure security and proper delegation of work:

* **Super Admin (`admin`)**: Has global access to the entire college/university. They can create departments, manage global resources (like physical Rooms and Academic Sessions), create new Admin accounts, and oversee timetables for all departments.
* **Department Admin (`HOD / Coordinator`)**: Their view is restricted to their assigned department only. They manage the teachers within their department, map subjects to classes, handle teacher workloads, approve leaves, and build the timetable specifically for their department.
* **Faculty / Teacher**: Can log in to view their personal timetable, check which substitute classes they have been assigned to, and apply for leaves. 
  * *Delegated Faculty:* Administrators can grant specific module permissions (e.g., Manage Subjects, Internal Tests) to a Faculty member. These delegated operations will seamlessly appear in their dashboard without giving them full HOD rights.

---

## 2. Step-by-Step System Setup (Where to Start)

If you are setting up the software for the very first time, or starting a brand new semester, you must follow this exact sequence. **Skipping a step will prevent you from completing the timetable.**

### Phase 1: Foundation (Super Admin)
1. **Academic Sessions**: Go to *Sessions* and create the current academic year (e.g., "2026-2027 Even Semester"). Make it the "Active" session.
2. **Time Slots**: Go to *Time Slots* and define the standard college timings (e.g., Slot 1: 09:00 AM - 10:00 AM).
3. **Departments**: Go to *Departments* and add all college departments (e.g., Computer Science, Mechanical).
4. **Rooms**: Go to *Rooms* and add all physical classrooms and labs along with their seating capacity.

### Phase 2: Academics (Super Admin)
5. **Classes & Sections**: Go to *Classes* and create the programs (e.g., BCA, B.Tech), Semesters, and Sections (Section A, Section B).
6. **Subjects**: Go to *Subjects* and add all courses. Define whether they are Theory or Lab, and specify the credits.

### Phase 3: Users & Staff (Super Admin & Dept Admin)
7. **Create Department Admins**: Go to *Users* and create accounts for the HODs, assigning them the `DEPARTMENT_ADMIN` role and linking them to their specific department.
8. **Add Teachers**: The Department Admin logs in, goes to *Teachers*, and adds all faculty members belonging to their department.

### Phase 4: Allocations & Timetable (Department Admin)
9. **Allocations (Crucial Step)**: Go to *Allocations*. This is where you connect a Teacher to a Subject and a Class. The system will calculate their total workload (credits).
10. **Timetable Manager**: Go to *Timetable Manager*. Select a Class, and drag-and-drop the allocated subjects into the weekly grid. The system will automatically block overlapping teachers to prevent clashes.
11. **Smart Room Allocator**: Go to *Smart Room Allocator*. Click "Auto-Assign" to let the software find and assign the best available physical rooms to the classes you just scheduled.

---

## 3. Page-by-Page Feature Guide

Here is a detailed breakdown of every page in the sidebar and what you can do there.

### 📊 Dashboard
* **What it does:** Provides a bird's-eye view of your data.
* **Features:** View total active teachers, total classes, pending leave requests, and total active subjects.

### 🏢 Departments (Super Admin Only)
* **What it does:** Manages the organizational structure.
* **Features:** Add, Edit, or Delete departments.

### 🗓️ Sessions (Super Admin Only)
* **What it does:** Controls the active academic timeline.
* **Features:** Add new semesters. Only one session can be "Active" at a time. All timetables and allocations are tied to the active session.

### 🚪 Rooms (Super Admin Only)
* **What it does:** Manages physical infrastructure.
* **Features:** Add Rooms/Labs, set capacity.

### 📚 Subjects
* **What it does:** The master list of courses being taught across departments.
* **Features:** 
  * Define Subject Code, Name, Credits, and Type (Theory/Lab).
  * **NPTEL / SWAYAM MOOC Integration:** Mark online courses with the `is_nptel` checkbox. NPTEL subjects are automatically highlighted with a rose background tint, crimson left border, and a red **NPTEL / SWAYAM** badge.
  * **NPTEL Statistics & Breakdown:** Monitor total online MOOC subject counts and credit totals via dedicated summary cards and a new **NPTEL (Cr)** column in the Department-wise Breakdown table.

### 🎓 Classes
* **What it does:** Manages the student groups.
* **Features:** 
  * Define the Program Name, Semester, and Section.
  * **Active/Inactive Toggle:** Manually activate or deactivate classes to hide them from timetables without deleting their historical data. Bulk uploaded classes are active by default.

### 👨‍🏫 Teachers
* **What it does:** Manages faculty data.
* **Features:** Add teachers, set their Short Names (used in the timetable grid), and manage their active status.

### 🔗 Allocations
* **What it does:** Maps workload to teachers.
* **Features:** 
  * Select a Class and assign a Subject to a specific Teacher.
  * The page automatically calculates the assigned Workload/Credits vs the maximum allowed. It smartly isolates **Theory (`l_credit`)** from **Practical (`p_credit`)** to accurately reflect actual teaching hours based on the assigned subject type.
  * **Assigned Teachers for NPTEL Courses:** Easily identify NPTEL/MOOC courses in the allocation matrix with distinct rose highlighting and badges. When a faculty coordinator is assigned to an NPTEL course, their name is tagged with an **Assigned (NPTEL)** badge. The assignment modal also displays an **NPTEL / SWAYAM** banner header.
  * **Smart Template Download with Elective Preview:**
    * Clicking **Download Template** first shows an informative popup before the file downloads.
    * The popup lists which classes have elective subjects **selected** (green ✅) and which have electives **available but not yet selected** (orange ⚠️).
    * Unselected electives will not appear in the template — this popup prevents silent data omissions.
    * Theory allocation rows in the CSV show `l_credit` (lecture credits); Lab rows show `p_credit` (practical credits) — ensuring accurate workload per teacher.
    * To include an elective in the template: go to **Classes → Edit → Available Elective Subjects** and select it first.

### ⏰ Time Slots (Super Admin Only)
* **What it does:** Manages the daily schedule framework.
* **Features:** Create start and end times for each lecture period.

### 📅 Timetable Manager
* **What it does:** The central hub where the actual timetable is generated, viewed, and manually adjusted.
* **Features:**
  * **Auto-Generation with 10-Second AI Analysis:** Clicking "Generate" or "Regenerate" triggers a 10-second animated analysis popup (Fetching Allocations → Resolving Conflicts → Optimizing Rooms → Finalizing Schedule) before the result is committed.
  * **Gap-Free Scheduling (Gravity Model):** The engine uses a sophisticated 9-stage constraint-satisfaction and gap-repair algorithm. It natively treats the entire day as a continuous block to automatically resolve cross-lunch gaps and gaps in merged class groups. It employs strategies like Same-Day Swap, Cross-Day Move, Chain Move, and Ruin & Recreate to guarantee a nearly 100% gap-free schedule for every section.
  * **Manual Editing (New!):** Click the "Edit" (pencil) icon on any slot in the Master Grid to manually swap subjects, teachers, or rooms.
  * **Hidden Slots Toggle:** Instantly hide empty columns and unallocated breaks using the toggle at the top-left for a cleaner view.
  * **Timetable History (Archive & Restore):** Old active timetables are safely archived when generating a new one. View past historical versions through the "View History" modal. Clicking "View Grid" loads the read-only historical timetable, where a prominent green "Restore Timetable" button allows you to safely reactivate it (after a double confirmation).
  * The system highlights conflicts in **Red** if a teacher is already busy in another class during that slot.

### 🤖 Smart Room Allocator
* **What it does:** Automates room assignments.
* **Features:** Instead of manually assigning rooms, click the "Auto-Assign" button. The system checks the class size, room capacity, and room availability to perfectly assign rooms without physical clashes.
  * **Merged Groups Support:** Visually distinct light blue rows for combined classes. Automatically calculates combined total strength for shared lab subjects, ensuring the assigned lab accommodates the entire group.
  * **Strict Lab Department Isolation:** Automatically filters labs by the department of the class. It will safely skip assignment if the department's labs are full, rather than misallocating to another department's lab.
  * **Explicit Room Overrides:** If a `room_id` is assigned directly during allocations, the allocator strictly forces the subject into that exact room.
  * **Section-Specific Lab Separation:** If merged sections have different lab subjects, they are intelligently separated in the "View Labs" modal so each section can be assigned a unique laboratory room.
  * **Clean Class Names:** Sections are neatly formatted (hiding redundant 'A' sections and cleanly numbering 'B1', 'B2', etc. for multi-section groups).

### 📑 Timetable Reports
* **What it does:** Exporting and viewing read-only timetables.
* **Features:** 
  * Generate PDF or Excel reports filtered by **Department Master**, **Specific Class**, **All Classes**, **Teacher**, **Room**, or **All Labs**.
  * **Smart Department Inheritance:** Navigating to reports automatically brings over the department you were working on in the main Timetable Manager.

### 📆 Daily Timetable (Substitutes, Replacements & Regeneration)
* **What it does:** Manages day-to-day live operations, daily timetable regeneration, and absent teachers.
* **Features:** 
  * **Daily Regeneration & History:** Regenerate the timetable for today or any specific date (`/admin/timetable/daily` & `/department/timetable/daily`). Click **View History** to audit past daily regenerations.
  * **Unavailable Classes & Merged Sections:** Exclude specific classes or merged sections for today only. The modal cleanly displays merged section titles (e.g., `1 Btech CSE`, `3 Btech CSE b1`, `3 Btech CSE b2`) with section-count badges.
  * **Unavailable Teachers & Lab Assistants:** Filter unavailable faculty and lab assistants by department. Retrieves all faculty records (up to 1,000) so no teachers are missed.
  * **Clean Class & Section Naming:** Single sections show clean program names (`BCA (H) Sem 1`) without trailing `- A` or `(A)`, while multi-section programs cleanly display batch names (`BCA (H) AI/ML Sem 3 B1`, `B2`, `B3`) without redundant alphabetical characters.
  * **Real-Time Sub-row Engagement Tracking:** Every scheduled class cell includes an italicized sub-row (`↳ Status / Engagement`) immediately indicating `[ENGAGED] <Substitute Teacher Name>` in green when a replacement is assigned, or `[ON LEAVE - UNASSIGNED]` in rose-red when pending.
  * **Auto-Suggest Substitutes:** If a teacher is on leave, click the "Suggest" button next to their class. The system finds free teachers in the same department during that specific time slot.
  * **Professional Excel Matrix Export (`xlsx-js-style`):** Download beautifully styled `.xlsx` matrix reports featuring corporate color coding (Mint Green for substitutes, Rose Red for unassigned leave, Yellow for breaks) and a light-blue subtitle ribbon displaying the exact **Downloaded At (Date & Time)** timestamp.

### 🏖️ Leave Approvals
* **What it does:** Manages faculty absences.
* **Features:** View leave requests submitted by teachers. Approve or Reject them. Approved leaves immediately trigger notifications in the Daily Timetable to arrange a substitute.

### 👥 Users (Super Admin Only)
* **What it does:** Controls access to the software.
* **Features:** Create login credentials for Admins and Faculty. Reset passwords.

### ⚙️ Settings & Audit Logs
* **What it does:** System security, governance, and configuration.
* **Features:** 
  * **Audit Logs (`/admin/audit`):** A comprehensive security ledger tracking every login, timetable regeneration, and data modification.
  * **Date Range & Monthly Filtering:** Quickly filter audit history by **All Time**, **Today**, **Last 7 Days**, **This Month (Monthly)**, or custom **From Date / To Date** ranges (`Kab se kab tak`).
  * **Max 25 Rows Pagination:** Cleanly displays **25 records per page** by default (with options for 50/100) along with interactive **Previous / Next page buttons** and page counts.
  * **Interactive Export Modal:** Click "Export" to choose exactly how much data to download (**Current Filtered Range**, **Current Page Only**, or **All Audit History**) in **Excel (.xlsx)** or **CSV (.csv)** format with clean timestamps and JSON details.
  * **Role-Based Session Security (Browser / System Close Protection):**
    * **Super Admin & Department Admin (Strict Security):** Auth cookies are issued as **session cookies** (no persistent expiry). The moment the browser is closed or the system restarts without clicking Logout, the session cookie is immediately cleared — **full re-login with OTP is mandatory** to regain access. There is zero grace period for administrative accounts.
    * **Faculty (1-Hour Convenience Policy):** Faculty members are allowed up to a **1-hour (60 minutes)** window after closing the browser or restarting their system without re-logging in. After 1 hour of closing the browser, their session automatically expires.
  * **Settings:** Global preferences like institution name and default password rules.

---

## 4. Daily Operational Workflow

Once the Timetable is built at the beginning of the semester, the heavy lifting is done! Your daily tasks are very simple:

1. **Morning Check:** The Department Admin logs in and checks **Leave Approvals** for any sudden teacher absences.
2. **Approve Leaves:** If a teacher is absent, approve their leave.
3. **Arrange Substitutes:** Go to the **Daily Timetable** page, select today's date. The system will flag the absent teacher's classes. Use the **Auto-Suggest** feature to quickly assign free teachers to cover those classes.
4. **Export:** Export the Daily Timetable to PDF and send it to the staff WhatsApp group or notice board so everyone knows the updated schedule for the day!

---

## 5. Advanced Features & Capabilities

The system comes equipped with several highly advanced features to cater to complex university scenarios:

* **Section-wise Subject Allocation**: You are not forced to give the same subjects to an entire Program/Class. You can assign entirely different subjects or electives on a strict *section-by-section* basis.
* **Strict Home Room Allocation & Teacher Fatigue Limits**: Theory classes are strictly bound to their Home Rooms. If occupied, the AI searches for an alternate time slot rather than misplacing classes. Additionally, the engine strictly enforces a maximum of 3 continuous time slots for teachers to prevent fatigue.
* **Primary & Secondary Departments**: A teacher can belong to a primary department (e.g., Mathematics) but can also be assigned to teach classes in secondary departments (e.g., Computer Science, Mechanical). The system intelligently aggregates their cross-departmental workload to ensure they aren't double-booked.
* **L-T-P (Lecture, Tutorial, Practical) Structure**: Full support for standard university L-T-P configurations.
* **Teacher Availability Constraints**: You can block out specific days and times when a teacher is "Not Available". The auto-scheduler will strictly avoid placing classes for that teacher during those restricted times.
* **Gap-Free Scheduling (Gravity Model)**: The scheduler natively treats the entire day as a continuous block (eliminating the old AM/PM split logic) to detect and resolve cross-lunch gaps. It implements a 9-stage resolution strategy including Swap Move, Cross-Day Move, Room Reassignment, Chain Move, and Ruin & Recreate. It also precisely targets merged class groups to ensure gaps within shared sections are natively resolved.
* **Balanced Teacher Workload Across 6 Days**: A `Teacher Day Balance Score` ensures teachers' classes are spread evenly across Monday–Saturday, preventing overloading on early days with empty days later in the week.
* **Enhanced Remedial Class Scheduling**: The class teacher assigned for Remedial is verified to be free in: (1) newly generated entries, (2) pre-existing active DB timetable rows, (3) teacher preference unavailability blocks, and (4) max daily load limits. This prevents cross-department double-booking for multi-department teachers acting as class teachers.
* **Fuzzy Logic Data Matching**: When using the Excel/CSV bulk upload feature for Subjects, Teachers, or Classes, the system employs advanced AI/Fuzzy logic. If you type "AI/DS" in one sheet and "AIDS" in another, or make minor spelling mistakes, the system will smartly detect and match them correctly.
* **Online Classes**: Subjects marked as "Online" do not consume any physical room resources, freeing up your campus infrastructure during generation.
* **Mandatory Remedial Classes**: The system is hard-coded to guarantee that every single class section will have exactly one "Remedial Class" slot per week. If no specific Class Teacher is defined, it utilizes a dummy `CT` placeholder to ensure the constraint never fails.
* **Combined / Merged Sections & Theory Sync**: Two different sections (e.g., Cyber Security and AI/DS) can study the same shared subject together in the same room. The system handles this seamlessly without UI clutter or double-booking the physical room. Furthermore, if these sections have *different* independent subjects, their independent theory classes are **aggressively synchronized** to run in parallel in the same time slot (different rooms). This completely prevents one section from studying while the other wastes time in the Library.
* **NPTEL / SWAYAM MOOC Integration**: Distinct support for online MOOC courses with fine-grained **Mode Selection** (`Lecture / Theory Only`, `Lab / Practical Only`, or `Both`). Whether a subject is NPTEL for just the Lecture part (while having a real physical Lab in the classroom) or just the Lab part, the auto-scheduler intelligently schedules only the selected MOOC component online once per week while scheduling the remaining physical component in real classrooms. NPTEL subjects are highlighted with mode-specific badges in Subject lists and Allocation tables, and are tracked in Overview cards with full breakdown counts. Both Admin and Department Admin pages support setting the mode via modal radio buttons as well as via Excel/CSV Bulk Upload (using column `NPTEL Mode (THEORY/LAB/BOTH)`).
* **Multi-Method OTP 2FA & Security**: Admin and Super Admin accounts are protected by mandatory Email OTP 2-Factor Authentication upon login. The login interface also features an interactive delivery channel selector for future **Mobile Phone (SMS & WhatsApp)** OTP authentication.
* **Daily Timetable Regeneration & Unavailable Filtering**: Ability to regenerate daily timetables for specific dates while excluding specific Unavailable Classes/Merged Sections (`1 Btech CSE`, `3 Btech CSE b1`) and Unavailable Teachers/Lab Assistants filtered by department.
* **Clean Academic Naming & Real-Time Engagement Tracking**: Daily matrix views automatically format single-section programs cleanly (e.g., `BCA (H) Sem 1` without `- A` or `(A)`) and multi-section batches (`BCA (H) AI/ML Sem 3 B1/B2/B3`), while displaying an italicized sub-row (`↳ Status / Engagement`) under every class cell to show real-time substitute assignments (`[ENGAGED] <Substitute Name>`) or unassigned leave slots.
* **Professional Excel Matrix Reports (`xlsx-js-style`)**: Exported `.xlsx` reports preserve rich corporate color palettes, custom `Calibri` fonts, cell borders, and automatic text wrapping, complete with a Navy Blue Title Banner (`#1E3A8A`) and an integrated light-blue Subtitle Ribbon (`#EFF6FF`) showing Department name, Timetable Date, and the exact **Download Timestamp (`Downloaded At: DD/MM/YYYY, HH:MM:SS AM/PM`)** merged across grid columns.
* **Deep Timetable Analysis**: A robust reporting suite that goes beyond simple timetables. Use the **Free Rooms Finder** to instantly see which rooms are empty at any given hour. Use the **Occupancy Matrix** to view a visual heatmap of room usage across the entire week. Filter these views by Department and instantly see the department short codes assigned to specific rooms and users.
* **Active/Inactive Toggle & Hidden Slots**: Keep interfaces clean by deactivating old classes without deleting historical data, and toggle hidden slots to instantly collapse unallocated breaks.


### Recent Updates (Internal Tests Module)
- **Multi-Subject/Multi-Room Scheduling**: Schedule multiple subjects in the same time slot across multiple rooms (Theory & Lab).
- **Consolidated Overview**: Same-class tests are grouped into a single view in the Overview Table automatically.
- **Smart Print & PDF Generation**: 
  - Dynamic interactive selection to 'Include Invigilators' or print without them.
  - Automatically merges identical class rows into grouped headers.
  - Generates 'Invigilators Legend' showing Name, Initial, and Employee ID.
- **Advanced Invigilator Logic**: Distinct assignment for Lab vs Theory Invigilators.
- **Direct Table Actions**: Print notices and PDFs directly from the Overview table without opening View Modals.
