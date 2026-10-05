import express from 'express';
import { body } from 'express-validator';
import { getDepartments, createDepartment, updateDepartment, deleteDepartment } from '../controllers/departmentController.js';
import { protect, requireRole, departmentScope } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Validations
const validateDept = [
    body('name').notEmpty().withMessage('Department name is required').trim(),
    body('short_code').notEmpty().withMessage('Short code is required').trim(),
    body('is_active').optional().isBoolean()
];

router.use(protect);
router.use(departmentScope); // All department routes require auth

router.get('/', getDepartments);
router.post('/', requireRole('SUPER_ADMIN'), validateDept, createDepartment);
router.put('/:id', requireRole('SUPER_ADMIN'), validateDept, updateDepartment);
router.delete('/:id', requireRole('SUPER_ADMIN'), deleteDepartment);

export default router;
