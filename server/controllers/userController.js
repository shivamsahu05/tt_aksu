import db from '../config/db.js';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import xlsx from 'xlsx';

// @route   GET /api/users
export const getUsers = async (req, res, next) => {
    try {
        let query = `
            SELECT u.id, u.username, u.email, u.mobile, u.is_active, u.failed_login_attempts, u.created_at, u.accessible_departments, u.permissions, u.role, u.department_id, u.teacher_id, d.name as department_name, d.short_code as department_code, t.full_name as teacher_name
            FROM users u
            LEFT JOIN departments d ON u.department_id = d.id
            LEFT JOIN teachers t ON u.teacher_id = t.id
        `;
        let params = [];
        if (req.user.role === 'DEPARTMENT_ADMIN') {
            query += ` WHERE u.department_id = ? AND u.role = 'FACULTY' `;
            params.push(req.user.department_id);
        }
        query += ` ORDER BY u.created_at DESC `;
        const [users] = await db.query(query, params);
        res.json({ success: true, data: users });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/users
export const createUser = async (req, res, next) => {
    try {
        let { username, email, password, role, department_id, accessible_departments, mobile, teacher_id } = req.body;
        
        if (req.user.role === 'DEPARTMENT_ADMIN') {
            if (role === 'SUPER_ADMIN') {
                return res.status(403).json({ success: false, message: 'Department Admin cannot create a Super Admin user.' });
            }
            role = 'FACULTY';
            department_id = req.user.department_id;
        }
        
        if (!username || !email || !password || !role) {
            return res.status(400).json({ success: false, message: 'Username, email, password, and role are required' });
        }
        if (role === 'FACULTY' && !teacher_id) {
            return res.status(400).json({ success: false, message: 'Please verify and link a valid Faculty Employee ID' });
        }
        
        const [existing] = await db.query('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'Username or email already exists' });
        }
        
        if (mobile) {
            const [existingMobile] = await db.query('SELECT id FROM users WHERE mobile = ?', [mobile]);
            if (existingMobile.length > 0) {
                return res.status(400).json({ success: false, message: 'Mobile number already in use' });
            }
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const finalDepartmentId = role === 'SUPER_ADMIN' ? null : (department_id || null);
        
        await db.query(`
            INSERT INTO users (username, email, password_hash, role, department_id, accessible_departments, mobile, teacher_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [username, email, hashedPassword, role, finalDepartmentId, accessible_departments ? JSON.stringify(accessible_departments) : null, mobile || null, teacher_id || null]);

        await db.query(`INSERT INTO audit_logs (user_id, action, table_name, new_value) VALUES (?, ?, ?, ?)`, 
            [req.user.id, 'create', 'users', JSON.stringify({ username, email, role, department_id: finalDepartmentId, accessible_departments, mobile, teacher_id })]);

        res.status(201).json({ success: true, message: 'User created successfully' });
    } catch (error) {
        next(error);
    }
};

// @route   PUT /api/users/:id
export const updateUser = async (req, res, next) => {
    try {
        const { id } = req.params;
        let { email, role, department_id, is_active, accessible_departments, permissions, mobile, teacher_id } = req.body;

        if (req.user.role === 'DEPARTMENT_ADMIN') {
            const [targetUser] = await db.query('SELECT department_id FROM users WHERE id = ?', [id]);
            if (targetUser.length === 0 || targetUser[0].department_id !== req.user.department_id) {
                return res.status(403).json({ success: false, message: 'Forbidden. Cannot modify users from other departments.' });
            }
            role = 'FACULTY';
            department_id = req.user.department_id;
        }

        const finalDepartmentId = role === 'SUPER_ADMIN' ? null : (department_id || null);

        if (mobile) {
            const [existingMobile] = await db.query('SELECT id FROM users WHERE mobile = ? AND id != ?', [mobile, id]);
            if (existingMobile.length > 0) {
                return res.status(400).json({ success: false, message: 'Mobile number already in use' });
            }
        }

        let updateQuery = `UPDATE users SET email = ?, role = ?, department_id = ?, is_active = ?, accessible_departments = ?, permissions = ?, mobile = ?, teacher_id = ?`;
        const queryParams = [email, role, finalDepartmentId, is_active, accessible_departments ? JSON.stringify(accessible_departments) : null, permissions ? JSON.stringify(permissions) : null, mobile || null, teacher_id || null];
        
        if (is_active === 1 || is_active === true || is_active === "1") {
            updateQuery += `, failed_login_attempts = 0`;
        }
        
        updateQuery += ` WHERE id = ?`;
        queryParams.push(id);

        await db.query(updateQuery, queryParams);

        await db.query(`INSERT INTO audit_logs (user_id, action, table_name, record_id, new_value) VALUES (?, ?, ?, ?, ?)`, 
            [req.user.id, 'update', 'users', id, JSON.stringify({ email, role, department_id: finalDepartmentId, is_active, accessible_departments, permissions, mobile, teacher_id })]);

        res.json({ success: true, message: 'User updated successfully' });
    } catch (error) {
        next(error);
    }
};

// @route   PUT /api/users/:id/password
export const changePassword = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { new_password, employee_code } = req.body;

        const [user] = await db.query(`SELECT role, teacher_id, department_id FROM users WHERE id = ?`, [id]);
        if (user.length === 0) return res.status(404).json({ success: false, message: 'User not found' });

        if (req.user.role === 'DEPARTMENT_ADMIN') {
            if (user[0].department_id !== req.user.department_id) {
                return res.status(403).json({ success: false, message: 'Forbidden. Cannot reset password for users in other departments.' });
            }
        }

        if (user[0].role === 'FACULTY') {
            if (!employee_code) {
                return res.status(400).json({ success: false, message: 'Employee ID is required to reset password for Faculty.' });
            }
            const [teacher] = await db.query(`SELECT id FROM teachers WHERE employee_code = ?`, [employee_code]);
            if (teacher.length === 0 || teacher[0].id !== user[0].teacher_id) {
                return res.status(400).json({ success: false, message: 'Invalid Employee ID for this user.' });
            }
        }

        const hashedPassword = await bcrypt.hash(new_password, 10);

        await db.query(`UPDATE users SET password_hash = ? WHERE id = ?`, [hashedPassword, id]);

        await db.query(`INSERT INTO audit_logs (user_id, action, table_name, record_id, new_value) VALUES (?, ?, ?, ?, ?)`, 
            [req.user.id, 'password_change', 'users', id, JSON.stringify({ action: 'password_reset' })]);

        res.json({ success: true, message: 'Password updated successfully' });
    } catch (error) {
        next(error);
    }
};

// @route   DELETE /api/users/:id
export const deleteUser = async (req, res, next) => {
    try {
        if (req.user.role === 'DEPARTMENT_ADMIN') {
            return res.status(403).json({ success: false, message: 'Forbidden. Department Admins cannot delete users.' });
        }
        const { id } = req.params;
        if (id == req.user.id) {
            return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
        }
        await db.query(`DELETE FROM users WHERE id = ?`, [id]);
        await db.query(`INSERT INTO audit_logs (user_id, action, table_name, record_id) VALUES (?, ?, ?, ?)`, 
            [req.user.id, 'delete', 'users', id]);
            
        res.json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/users/upload
export const uploadUsers = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const results = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        // Check if user uploaded the unmodified sample template
        const isSampleTemplate = results.some(row => {
            const uname = (row.username || '').toString().toLowerCase();
            const em = (row.email || '').toString().toLowerCase();
            return uname === 'shivam001' || em.includes('sample@college.edu') || uname === 'johndoe' || uname === 'janedoe';
        });
        if (isSampleTemplate) {
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(400).json({
                success: false,
                message: 'This appears to be the sample template! Please replace the sample rows with your actual staff details before uploading.'
            });
        }

        let successCount = 0;
        let errorCount = 0;
        let errors = [];

        for (let i = 0; i < results.length; i++) {
            const row = results[i];
            try {
                let username = (row.username || '').toString().trim();
                const email = (row.email || '').toString().trim();
                let password = (row.password || '').toString().trim();
                let rawRole = (row.role || '').toString().trim().toUpperCase();
                const mobile = (row.mobile || '').toString().trim();
                const departmentCode = (row.department_code || '').toString().trim();
                const employeeCode = (row.employee_code || '').toString().trim();

                if (!email || !rawRole) {
                    throw new Error('Email and role are required');
                }

                // Fuzzy role matching
                let role = 'FACULTY';
                if (rawRole.includes('SUPER') || rawRole.includes('SUPER_ADMIN')) {
                    role = 'SUPER_ADMIN';
                } else if (rawRole.includes('DEPT') || rawRole.includes('DEPARTMENT') || rawRole.includes('ADMIN') || rawRole.includes('HOD')) {
                    role = 'DEPARTMENT_ADMIN';
                } else if (rawRole.includes('FAC') || rawRole.includes('TEACHER') || rawRole.includes('PROF') || rawRole === 'FACULTY') {
                    role = 'FACULTY';
                } else if (['SUPER_ADMIN', 'DEPARTMENT_ADMIN', 'FACULTY'].includes(rawRole)) {
                    role = rawRole;
                } else {
                    throw new Error(`Invalid role '${rawRole}'`);
                }

                // Fuzzy department matching
                let finalDepartmentId = null;
                if (req.user.role === 'DEPARTMENT_ADMIN') {
                    if (role === 'SUPER_ADMIN') {
                        throw new Error('Department Admin cannot create Super Admin users');
                    }
                    role = 'FACULTY';
                    finalDepartmentId = req.user.department_id;
                } else if (role !== 'SUPER_ADMIN' && departmentCode) {
                    const cleanDept = departmentCode.replace(/\s+/g, '').toLowerCase();
                    const [dept] = await db.query(`
                        SELECT id FROM departments 
                        WHERE LOWER(REPLACE(short_code, ' ', '')) = ? 
                           OR LOWER(REPLACE(name, ' ', '')) = ?
                           OR LOWER(short_code) LIKE CONCAT('%', ?, '%')
                           OR LOWER(name) LIKE CONCAT('%', ?, '%')
                        LIMIT 1
                    `, [cleanDept, cleanDept, cleanDept, cleanDept]);
                    if (dept.length > 0) {
                        finalDepartmentId = dept[0].id;
                    } else {
                        throw new Error(`Department code '${departmentCode}' not found`);
                    }
                }

                // Teacher matching (flexible E/e/digits)
                let finalTeacherId = null;
                let teacherObj = null;
                if (role === 'FACULTY' && employeeCode) {
                    const cleanEmp = employeeCode.replace(/\s+/g, '').toLowerCase();
                    const [teacher] = await db.query(`
                        SELECT id, full_name, employee_code, email, mobile, department_id 
                        FROM teachers 
                        WHERE LOWER(REPLACE(employee_code, ' ', '')) = ?
                           OR LOWER(REPLACE(employee_code, ' ', '')) = CONCAT('e', ?)
                           OR LOWER(employee_code) LIKE CONCAT('%', ?, '%')
                        LIMIT 1
                    `, [cleanEmp, cleanEmp, cleanEmp]);
                    if (teacher.length > 0) {
                        teacherObj = teacher[0];
                        finalTeacherId = teacherObj.id;
                        if (!finalDepartmentId) finalDepartmentId = teacherObj.department_id;
                    } else {
                        throw new Error(`Employee code '${employeeCode}' not found in teachers`);
                    }
                }

                // Auto-generate username if empty/not provided in CSV
                if (!username) {
                    if (teacherObj) {
                        const firstName = (teacherObj.full_name.split(' ')[0] || 'faculty').replace(/[^a-zA-Z]/g, '');
                        const empDigits = (teacherObj.employee_code.replace(/[^0-9a-zA-Z]/g, '') || '001').slice(-3);
                        username = (firstName.toLowerCase() + empDigits).toLowerCase();
                    } else if (email) {
                        username = email.split('@')[0].toLowerCase().replace(/[^a-zA-Z0-9_.]/g, '');
                    } else {
                        username = 'user_' + Date.now();
                    }
                }

                // Ensure username is unique
                let uniqueUsername = username;
                let uSuffix = 1;
                while (true) {
                    const [existingU] = await db.query('SELECT id FROM users WHERE username = ?', [uniqueUsername]);
                    if (existingU.length === 0) break;
                    uniqueUsername = `${username}_${uSuffix++}`;
                }
                username = uniqueUsername;

                if (!password) {
                    const firstName = username.split(' ')[0] || 'User';
                    const empDigits = employeeCode.replace(/[^0-9a-zA-Z]/g, '').slice(-3) || '001';
                    password = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase() + '@' + empDigits + '#';
                }

                const [existingEmail] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
                if (existingEmail.length > 0) {
                    throw new Error('Email already exists');
                }

                if (mobile) {
                    const [existingMobile] = await db.query('SELECT id FROM users WHERE mobile = ?', [mobile]);
                    if (existingMobile.length > 0) {
                        throw new Error('Mobile number already exists');
                    }
                }

                const hashedPassword = await bcrypt.hash(password, 10);

                await db.query(`
                    INSERT INTO users (username, email, password_hash, role, department_id, mobile, teacher_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [username, email, hashedPassword, role, finalDepartmentId, mobile || null, finalTeacherId]);

                successCount++;
            } catch (error) {
                errorCount++;
                errors.push(`Row ${i + 2} (${row.username || 'unknown'}): ${error.message}`);
            }
        }

        // Clean up file
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.json({
            success: true,
            message: `Upload complete. Success: ${successCount}, Failed: ${errorCount}`,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        next(error);
    }
};
