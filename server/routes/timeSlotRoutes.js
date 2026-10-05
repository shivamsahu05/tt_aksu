import express from 'express';
import { body } from 'express-validator';
import {
    getTimeSlots,
    createTimeSlot,
    updateTimeSlot,
    deleteTimeSlot
} from '../controllers/timeSlotController.js';
import { protect, requireRole, departmentScope } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(protect);
router.use(departmentScope);

router.get('/', getTimeSlots);

const validateSlot = [
    body('slot_order').isInt({ min: 1 }).withMessage('Slot order must be a positive integer'),
    body('start_time').matches(/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/).withMessage('Valid start time is required (HH:MM)'),
    body('end_time').matches(/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/).withMessage('Valid end time is required (HH:MM)'),
    body('slot_type').isIn(['lecture', 'break']).withMessage('Invalid slot type')
];

router.post('/', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), validateSlot, createTimeSlot);
router.put('/:id', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), validateSlot, updateTimeSlot);
router.delete('/:id', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), deleteTimeSlot);

export default router;
