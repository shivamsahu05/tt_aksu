import express from 'express';
import { body } from 'express-validator';
import { getSessions, createSession, updateSession, deleteSession } from '../controllers/sessionController.js';
import { protect, requireRole, departmentScope } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Validations
const validateSession = [
    body('name').notEmpty().withMessage('Session name is required').trim(),
    body('start_date').isDate().withMessage('Valid start date is required'),
    body('end_date').isDate().withMessage('Valid end date is required'),
    body('is_active').optional().isBoolean()
];

router.use(protect);
router.use(departmentScope);

router.get('/', getSessions);
router.post('/', requireRole('SUPER_ADMIN'), validateSession, createSession);
router.put('/:id', requireRole('SUPER_ADMIN'), validateSession, updateSession);
router.delete('/:id', requireRole('SUPER_ADMIN'), deleteSession);

export default router;
