import express from 'express';
import { body } from 'express-validator';
import { 
    getAllocations, 
    getAllocationMatrix,
    getAvailableSubjects, 
    getTeachersWorkload, 
    createAllocation, 
    updateAllocation, 
    toggleOnlineStatus,
    deleteAllocation,
    bulkTemplate,
    bulkUpload,
    electivePreview,
    clearAllocations
} from '../controllers/allocationController.js';
import { protect, requireRole, departmentScope } from '../middlewares/authMiddleware.js';
import { uploadCSV } from '../middlewares/uploadMiddleware.js';

const router = express.Router();

const validateAllocation = [
    body('section_id').isInt().withMessage('Section ID is required'),
    body('subject_id').isInt().withMessage('Subject ID is required'),
    body('teacher_id').isInt().withMessage('Teacher ID is required')
];

const validateUpdate = [
    body('teacher_id').isInt().withMessage('Teacher ID is required')
];

router.use(protect);
router.use(departmentScope);

router.get('/', getAllocations);
router.get('/matrix', getAllocationMatrix);
router.get('/bulk-template', bulkTemplate);
router.get('/elective-preview', electivePreview);
router.post('/bulk-upload', uploadCSV.single('file'), bulkUpload);
router.get('/available-subjects', getAvailableSubjects);
router.get('/teachers-workload', getTeachersWorkload);

router.post('/', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), validateAllocation, createAllocation);
router.put('/:id', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), validateUpdate, updateAllocation);
router.patch('/:id/toggle-online', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), toggleOnlineStatus);
router.delete('/clear/all', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), clearAllocations);
router.delete('/:id', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), deleteAllocation);

export default router;
