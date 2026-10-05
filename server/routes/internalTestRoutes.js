import express from 'express';
import { getInternalTests, addInternalTest, updateInternalTest, deleteInternalTest, getAvailableInvigilators } from '../controllers/internalTestController.js';
import { protect, hasPermission } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(protect);
router.use(hasPermission('manage_internal_tests'));

router.get('/available-teachers', getAvailableInvigilators);
router.get('/', getInternalTests);
router.post('/', addInternalTest);
router.put('/:id', updateInternalTest);
router.delete('/:id', deleteInternalTest);

export default router;
