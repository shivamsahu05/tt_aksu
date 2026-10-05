import express from 'express';
import { getUsers, createUser, updateUser, deleteUser, changePassword, uploadUsers } from '../controllers/userController.js';
import { protect, requireRole } from '../middlewares/authMiddleware.js';
import { uploadCSV } from '../middlewares/uploadMiddleware.js';

const router = express.Router();

router.use(protect);
router.use(requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'));

router.get('/', getUsers);
router.post('/', createUser);
router.post('/upload', uploadCSV.single('file'), uploadUsers);
router.put('/:id', updateUser);
router.put('/:id/password', changePassword);
router.delete('/:id', deleteUser);

export default router;
