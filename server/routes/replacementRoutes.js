import express from 'express';
import { getReplacements, suggestSubstitutes, getDailySuggestions, assignReplacement, updateReplacementStatus, deleteReplacement, deleteDailyReplacements } from '../controllers/replacementController.js';
import { protect, requireRole, departmentScope } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(protect);
router.use(departmentScope);

router.get('/', getReplacements);
router.get('/suggestions', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), suggestSubstitutes);
router.get('/daily-suggestions', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), getDailySuggestions);
router.post('/', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), assignReplacement);
router.put('/:id/status', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), updateReplacementStatus);
router.delete('/daily/all', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), deleteDailyReplacements);
router.delete('/:id', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), deleteReplacement);

export default router;
