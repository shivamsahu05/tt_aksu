import express from 'express';
import { body } from 'express-validator';
import { getTeachers, createTeacher, updateTeacher, deleteTeacher, bulkUploadTeachers, deleteTeachersByDepartment, verifyTeacher, getTeacherStats } from '../controllers/teacherController.js';
import { protect, requireRole, departmentScope } from '../middlewares/authMiddleware.js';
import { uploadTeacherPhoto, uploadCSV } from '../middlewares/uploadMiddleware.js';

const router = express.Router();

const validateTeacher = [
    body('department_id').optional().isInt().withMessage('Valid Department ID is required'),
    body('full_name').notEmpty().withMessage('Full name is required').trim(),
    body('short_name').optional({ checkFalsy: true }).trim(),
    body('email').optional({ checkFalsy: true }).isEmail().withMessage('Valid email is required'),
    body('mobile').optional({ checkFalsy: true }).isMobilePhone().withMessage('Valid mobile number is required'),
    body('employee_code').notEmpty().withMessage('Employee Code is required').trim(),
    body('designation').optional({ checkFalsy: true }).trim(),
    body('is_active').optional().isBoolean()
];

router.use(protect);
router.use(departmentScope);

import { getTeacherPreferences, updateTeacherPreferences, getDepartmentTeacherPreferences } from '../controllers/teacherPreferenceController.js';

router.get('/department/:deptId/preferences', getDepartmentTeacherPreferences);
router.get('/preferences/:id', getTeacherPreferences);
router.post('/preferences/:id', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), updateTeacherPreferences);

router.get('/', getTeachers);
router.get('/stats', getTeacherStats);
router.get('/verify/:code', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), verifyTeacher);
router.post('/bulk', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), uploadCSV.single('file'), bulkUploadTeachers);
router.post('/', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), uploadTeacherPhoto.single('photo'), validateTeacher, createTeacher);
router.put('/:id', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), uploadTeacherPhoto.single('photo'), validateTeacher, updateTeacher);
router.delete('/bulk-by-department', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), deleteTeachersByDepartment);
router.delete('/:id', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), deleteTeacher);

export default router;
