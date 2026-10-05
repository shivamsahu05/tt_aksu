import express from 'express';
import { getNotifications, markAsRead, markAllAsRead, checkReminders, deleteAllNotifications } from '../controllers/notificationController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(protect);

router.get('/', getNotifications);
router.post('/check-reminders', checkReminders);
router.put('/:id/read', markAsRead);
router.put('/read-all', markAllAsRead);
router.delete('/all', deleteAllNotifications);

export default router;
