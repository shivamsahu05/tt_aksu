import express from 'express';
import { getLeaves, applyLeave, updateLeaveStatus, updateLeave, deleteLeave } from '../controllers/leaveController.js';
import { protect, requireRole, departmentScope, hasPermission } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(protect);
router.use(departmentScope);

router.get('/', getLeaves); // Faculty can see theirs, Admins can see all
router.post('/', applyLeave); // Faculty and Admin can apply
router.put('/:id', hasPermission('manage_leaves'), updateLeave); // Edit leave
router.delete('/:id', hasPermission('manage_leaves'), deleteLeave); // Delete leave
router.put('/:id/status', hasPermission('manage_leaves'), updateLeaveStatus); // Keep for compatibility if needed

export default router;
