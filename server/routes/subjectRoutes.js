import express from 'express';
import { body } from 'express-validator';
import { getSubjects, getSubjectStats, getOverviewDetails, createSubject, updateSubject, deleteSubject, bulkUploadSubjects, bulkDeleteSubjects, deleteSubjectsByDepartment, clearAllNptel } from '../controllers/subjectController.js';
import { protect, requireRole, departmentScope, hasPermission } from '../middlewares/authMiddleware.js';
import { uploadCSV } from '../middlewares/uploadMiddleware.js';

const router = express.Router();

const validateSubject = [
    body('department_id').isInt().withMessage('Valid Department ID is required'),
    body('full_name').notEmpty().withMessage('Full name is required').trim(),
    body('short_code').notEmpty().withMessage('Short code is required').trim(),
    body('subject_type').isIn(['theory', 'lab', 'both']).withMessage('Invalid subject type'),
    body('total_credits').isFloat({ min: 0 }).withMessage('Credits must be a positive number'),
    body('l_credit').isFloat({ min: 0 }).withMessage('L credits must be a positive number'),
    body('t_credit').optional().isFloat({ min: 0 }).withMessage('T credits must be a positive number'),
    body('p_credit').isFloat({ min: 0 }).withMessage('P credits must be a positive number'),
    body('semester').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1, max: 10 }).withMessage('Semester must be between 1 and 10'),
    body('is_active').optional().isBoolean()
];

router.use(protect);
router.use(departmentScope);

router.get('/stats', getSubjectStats);
router.get('/overview-details', getOverviewDetails);
router.get('/', getSubjects);
router.post('/clear-nptel', hasPermission('manage_subjects'), clearAllNptel);
router.post('/bulk', hasPermission('manage_subjects'), uploadCSV.single('file'), bulkUploadSubjects);
router.post('/bulk-delete', hasPermission('manage_subjects'), bulkDeleteSubjects);
router.post('/bulk-delete-by-department', hasPermission('manage_subjects'), deleteSubjectsByDepartment);
router.post('/', hasPermission('manage_subjects'), validateSubject, createSubject);
router.put('/:id', hasPermission('manage_subjects'), validateSubject, updateSubject);
router.delete('/:id', hasPermission('manage_subjects'), deleteSubject);

export default router;
