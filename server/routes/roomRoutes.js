import express from 'express';
import { body } from 'express-validator';
import { getRooms, getBuildings, createRoom, updateRoom, deleteRoom, bulkUploadRooms, deleteRoomsByDepartment } from '../controllers/roomController.js';
import { protect, requireRole, departmentScope, hasPermission } from '../middlewares/authMiddleware.js';
import { uploadCSV } from '../middlewares/uploadMiddleware.js';

const router = express.Router();

// Validations
const validateRoom = [
    body('room_number').notEmpty().withMessage('Room number is required').trim(),
    body('capacity').isInt({ min: 1 }).withMessage('Capacity must be at least 1'),
    body('building').optional().trim(),
    body('is_lab').optional().isBoolean(),
    body('is_active').optional().isBoolean()
];

router.use(protect);
router.use(departmentScope);

router.get('/', getRooms);
router.get('/buildings', getBuildings);
router.post('/bulk', hasPermission('manage_rooms'), uploadCSV.single('file'), bulkUploadRooms);
router.post('/', hasPermission('manage_rooms'), validateRoom, createRoom);
router.post('/bulk-delete', hasPermission('manage_rooms'), deleteRoomsByDepartment);
router.put('/:id', hasPermission('manage_rooms'), validateRoom, updateRoom);
router.delete('/:id', hasPermission('manage_rooms'), deleteRoom);

export default router;
