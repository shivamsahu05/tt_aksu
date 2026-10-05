import express from 'express';
import { getDashboardStats } from '../controllers/dashboardController.js';
import { protect, departmentScope } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(protect);
router.use(departmentScope);

router.get('/stats', getDashboardStats);

export default router;
