import express from 'express';
import { getSettings, updateSettings, cleanupDuplicates, analyzeDuplicates, testSmtp, resetSessionAssignments, triggerDailyNotifications } from '../controllers/settingsController.js';
import { protect, requireRole, departmentScope } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(protect);
router.use(departmentScope);

router.get('/', getSettings); // Everyone can view
router.put('/', requireRole('SUPER_ADMIN'), updateSettings); // Only admin can update
router.post('/test-smtp', requireRole('SUPER_ADMIN'), testSmtp);
router.post('/reset-session-assignments', requireRole('SUPER_ADMIN'), resetSessionAssignments);
router.get('/analyze-duplicates', requireRole('SUPER_ADMIN'), analyzeDuplicates);
router.delete('/cleanup-duplicates', requireRole('SUPER_ADMIN'), cleanupDuplicates);
router.post('/trigger-daily-notifications', requireRole('SUPER_ADMIN'), triggerDailyNotifications);

export default router;
