# Timetable Management System (TTMS)

This is a modern, responsive Timetable Management System (TTMS) built using the **MERN** stack (MySQL, Express, React, Node.js). It supports dynamic timetable generation, conflict detection, user roles (Super Admin, Department Admin, Faculty), granular Role-Based Access Control (RBAC), and extensive reporting features.

**Designed & Developed by [HackVitraSec Solution](https://hackvitrasec.com/)**

## Tech Stack
- **Frontend:** React (Vite), Bootstrap 5, React Router, React Hook Form
- **Backend:** Node.js, Express.js
- **Database:** MySQL
- **Authentication:** JWT (JSON Web Tokens) with Granular Module Permissions

## Project Structure
- `/client`: React Frontend application
- `/server`: Node.js Backend API

## Prerequisites
- Node.js (v18+)
- MySQL (v8+)

## Installation and Setup

### 1. Database Setup
1. Open MySQL/phpMyAdmin and create a database (e.g., `timetable_db`).
2. Run the provided database initialization script to create tables and default data.
3. Ensure your MySQL server is running.

### 2. Backend Setup
1. Navigate to the `server` directory:
   ```bash
   cd server
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the `server` directory with the following variables:
   ```env
   PORT=5000
   DB_HOST=localhost
   DB_USER=root
   DB_PASS=
   DB_NAME=timetable_db
   JWT_SECRET=your_jwt_secret_here
   JWT_EXPIRES_IN=8h
   ```
4. Start the backend server:
   ```bash
   npm run dev
   ```

### 3. Frontend Setup
1. Open a new terminal and navigate to the `client` directory:
   ```bash
   cd client
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the React development server:
   ```bash
   npm run dev
   ```

## Default Login Credentials
- **Username:** `admin`
- **Password:** `admin123`

*(Note: Change the default password upon first login.)*

## Key Features
- **Dashboard Overview:** Real-time analytics, today's live schedule, and pending conflict/replacement notifications grouped intelligently.
- **Granular Role-Based Access Control (RBAC):** Assign specific module permissions (e.g., Manage Leaves, Manage Internal Tests, Subjects) individually to Faculty members without giving them full Department Admin rights.
- **Master Data Management:** Manage departments, sessions, time slots, rooms, subjects, and classes.
  - **Active/Inactive Class Management:** Instantly activate or deactivate classes. Inactive classes are cleanly filtered out from timetable allocations and matrices, preserving historical data without clutter. Bulk uploaded classes are active by default.
- **Advanced Teacher Management:**
  - Assign a **Primary Department** and multiple **Secondary Departments** to allow inter-departmental teaching.
  - Track employee code, designation, and **Availability Constraints** (Available / Not Available for specific days and slots).
- **Subject Allocations & Structure:** 
  - Section-wise subject allocation (different sections of the same class can have different subjects/electives).
  - Support for **L-T-P (Lecture, Tutorial, Practical)** credit structures. Accurately segregates Theory (`l_credit`) and Lab (`p_credit`) workload assignments for teachers, preventing tutorial credit miscalculations.
  - Dynamically assign subjects to teachers based on theory or lab requirements.
  - Advanced auto-scheduler algorithm that automatically handles teacher clashes and room overlaps.
  - **Strict Home Room Allocation:** Theory classes are strictly bound to their Home Rooms. If occupied, the AI will search for a different time slot rather than misplacing them to random rooms or exceeding capacity.
  - **Teacher Fatigue Limit:** Enforces a maximum limit of continuous time slots for teachers (e.g., max 3 continuous classes) followed by a mandatory break to prevent overworking.
  - **Mandatory Remedial Classes:** Automatically schedules exactly one Remedial Class per week for every section.
  - **Online Classes:** Classes marked as "Online" do not consume physical room resources.
  - **Merged Sections Handling & Theory Sync:** Supports combined classes (e.g., Cyber & AI/DS studying together) efficiently without duplicate room UI clutter or database conflict errors. For merged sections with different independent subjects, aggressively synchronizes their theory classes into the same time slot to perfectly align their schedules.
  - **Smart Allocation Template Download:** Before downloading the template CSV, an informative popup shows which elective subjects are selected (or missing) per class. Theory rows show `l_credit`; Lab rows show `p_credit` — ensuring teachers receive accurate workload data.
- **Deep Timetable Analysis & Reporting:**
  - **Timetable History & Restoration:** Automatically archives old timetables upon generating a new one. View past historical versions through the "View History" modal and securely restore/reactivate them to the main grid with a single click.
  - **Manual Timetable Editing:** Administrators can click on any generated slot in the Master Grid and manually override the subject, teacher, or room.
  - **Hidden Slots Toggling:** Instantly reveal or hide unallocated breaks and empty slots in the master timetable view.
  - **Free Rooms Finder:** Instantly find completely empty rooms for a specific day and time slot.
  - **Room Occupancy Matrix:** Visual heatmap showing green/red indicators for room utilization across the week.
  - **Comprehensive Reports & Analysis:** Generate PDF/Excel reports filtered by Department, Specific Class, Teacher, Room, and Labs. Includes intelligent department-wise inheritance for cross-page navigation and department short code visibility.
- **NPTEL / SWAYAM MOOC Courses Integration:**
  - **Dedicated NPTEL Stats Cards:** View total online MOOC subject counts and aggregate NPTEL credits directly on the Admin & Department Subject dashboards.
  - **Distinct Row Highlighting:** NPTEL / SWAYAM subjects are distinctly highlighted with a rose background tint (`#fff1f2`), crimson border, and badge across all subject and allocation tables.
  - **Faculty Coordinator Assignment:** Map NPTEL courses to assigned teachers with clear `Assigned (NPTEL)` tags in the allocation matrix and assignment modal.
- **Daily Operations & Timetable Regeneration:**
  - **Daily Regeneration & History:** Regenerate daily timetables for specific dates (`/admin/timetable/daily` & `/department/timetable/daily`) and view full regeneration history via `/api/timetable/daily-history`.
  - **Unavailable Classes & Merged Sections:** Exclude specific classes or merged sections for today only. Cleanly displays merged section titles (e.g., `1 Btech CSE`, `3 Btech CSE b1`).
  - **Unavailable Teachers & Lab Assistants:** Department-wise filtering of unavailable faculty and lab assistants (supports up to 1,000 teachers per department).
  - **Clean Academic Naming:** Formats single-section programs cleanly (`BCA (H) Sem 1`) without trailing `- A` or `(A)` and multi-section batches (`BCA (H) AI/ML Sem 3 B1/B2/B3`) without redundant alphabetical labels.
  - **Real-Time Sub-row Engagement Tracking:** Every scheduled class cell features an italicized sub-row (`↳ Status / Engagement`) immediately showing `[ENGAGED] <Substitute Name>` in green or `[ON LEAVE - UNASSIGNED]` in rose-red.
  - **Professional Excel Matrix Reports (`xlsx-js-style`):** Exports richly styled `.xlsx` reports with corporate color palettes, custom `Calibri` fonts, cell borders, and header subtitle ribbons including exact **Downloaded At (Date & Time)** timestamps.
  - **Substitute & Replacement Management:** Easily engage replacement teachers for absent staff with live green/red visual indicators and substitute tracking.
- **Advanced Timetable Generation Intelligence:**
  - **Gap-Free Scheduling (Pack-Left Algorithm):** A two-phase post-processing engine runs after initial placement. Phase 1 pulls classes left into gaps (up to 15 iterations). Phase 2 aggressively packs every class to its earliest possible slot on that day (up to 20 passes), guaranteeing sections never have holes between classes.
  - **Balanced Teacher Workload Across 6 Days:** A `Teacher Day Balance Score` actively distributes each teacher's classes evenly across all 6 working days.
  - **Enhanced Remedial Class Teacher Availability:** When scheduling the mandatory Remedial Class, the engine checks availability across new session entries, pre-existing DB timetable rows, teacher preference blocks, and max daily load — eliminating cross-department double-booking.
  - **10-Second AI Analysis Popup:** A rich animated progress popup appears during generation (Fetching Allocations → Resolving Conflicts → Optimizing Rooms → Finalizing Schedule) for clear visual feedback.
- **Smart Room Allocator:** Automates room assignments based on class size vs room capacity, ensuring no physical clashes. Visually highlights merged classes, smartly combines overlapping lab subjects for optimal room sizing, and neatly formats section names. **Strictly isolates labs** by department to prevent cross-department lab stealing, and enforces **Explicit Room Overrides** when assigned by an admin.
- **Bulk Data Uploads with Fuzzy Logic:** Upload teachers, subjects, and classes via Excel/CSV. The system uses advanced **Fuzzy Logic** to intelligently match slight spelling variations (e.g., "AI-DS" vs "AIDS").
- **Multi-Method OTP Authentication & Security:**
  - **Email OTP 2-Factor Authentication:** Admin and Super Admin logins are secured with mandatory Email OTP verification.
  - **Session-Based Auth (Browser-Close = Auto Logout):** Admin and Super Admin cookies are issued as session cookies with no `maxAge`. Closing the browser immediately invalidates the session — re-login and OTP verification are mandatory every time.
  - **Mobile Phone (SMS / WhatsApp) Selector:** Includes a future-ready delivery channel selector in the login UI for upcoming SMS and WhatsApp OTP authentication.
  - **Audit Logs:** Complete audit trail tracking user logins, timetable modifications, and administrative actions.
- **Leaves & Replacements:** Faculty can view their schedule and apply for leaves. HODs/Admins can effortlessly manage teacher replacements for absences.
- **Fully Responsive UI:** Elegant, premium dark/light themes tailored to work beautifully on desktops, tablets, and smartphones.

## License
MIT License


### Recent Updates (Internal Tests Module)
- **Multi-Subject/Multi-Room Scheduling**: Schedule multiple subjects in the same time slot across multiple rooms (Theory & Lab).
- **Consolidated Overview**: Same-class tests are grouped into a single view in the Overview Table automatically.
- **Smart Print & PDF Generation**: 
  - Dynamic interactive selection to 'Include Invigilators' or print without them.
  - Automatically merges identical class rows into grouped headers.
  - Generates 'Invigilators Legend' showing Name, Initial, and Employee ID.
- **Advanced Invigilator Logic**: Distinct assignment for Lab vs Theory Invigilators.
- **Direct Table Actions**: Print notices and PDFs directly from the Overview table without opening View Modals.
