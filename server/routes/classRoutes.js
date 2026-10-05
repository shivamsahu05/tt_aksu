import express from 'express';
import { body } from 'express-validator';
import { getClasses, getAllSections, getClassById, createClass, updateClass, deleteClass, bulkUploadClasses, bulkDeleteClasses, getAllSectionsWithRooms, saveRoomAllocations, updateSectionStrength, mergeSections, unmergeSections } from '../controllers/classController.js';
import { protect, requireRole, departmentScope, hasPermission } from '../middlewares/authMiddleware.js';
import { uploadCSV } from '../middlewares/uploadMiddleware.js';

const router = express.Router();

const validateClass = [
    body('department_id').isInt().withMessage('Department ID is required'),
    body('session_id').isInt().withMessage('Session ID is required'),
    body('program_name').notEmpty().withMessage('Program name is required').trim(),
    body('semester').isInt({ min: 1, max: 8 }).withMessage('Semester must be between 1 and 8'),
    body('sections').isArray().withMessage('Sections must be an array').optional(),
    body('sections.*.section_name').notEmpty().withMessage('Section name is required'),
    body('sections.*.student_strength').isInt({ min: 0 }).withMessage('Strength must be positive').optional(),
    body('sections.*.home_room_id').optional({ nullable: true, checkFalsy: true }).isInt()
];

router.use(protect);
router.use(departmentScope);

router.get('/', getClasses);
router.get('/all-sections', getAllSections);
router.get('/sections-suggestions', getAllSectionsWithRooms);
router.post('/save-room-allocations', hasPermission('manage_classes'), saveRoomAllocations);
router.get('/:id', getClassById);
router.post('/bulk-upload', hasPermission('manage_classes'), uploadCSV.single('file'), bulkUploadClasses);
router.post('/bulk-delete', hasPermission('manage_classes'), bulkDeleteClasses);
router.post('/', hasPermission('manage_classes'), validateClass, createClass);
router.post('/merge-sections', hasPermission('manage_classes'), mergeSections);
router.post('/unmerge-sections', hasPermission('manage_classes'), unmergeSections);
router.put('/sections/:id/strength', hasPermission('manage_classes'), updateSectionStrength);
router.put('/:id', hasPermission('manage_classes'), validateClass, updateClass);
router.delete('/:id', hasPermission('manage_classes'), deleteClass);

export default router;
