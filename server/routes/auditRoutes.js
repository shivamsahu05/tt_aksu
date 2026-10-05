import express from 'express';
import { getAuditLogs } from '../controllers/auditController.js';
import { protect, requireRole, departmentScope } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(protect);
router.use(departmentScope);
router.use(requireRole('SUPER_ADMIN'));

router.get('/', getAuditLogs);

export default router;
