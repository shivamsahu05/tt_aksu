import express from 'express';
import { login, logout, getMe, verifyOtp, resendOtp, sendOtp } from '../controllers/authController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.post('/login', login);
router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/resend-otp', resendOtp);
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);

export default router;
