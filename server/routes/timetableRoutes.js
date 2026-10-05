import express from 'express';
import { 
    generateTimetable, 
    analyzePreGeneration,
    validateMove, 
    getTimetable, 
    updateTimetableSlot, 
    deleteTimetableSlot,
    getTimetableSchema,
    createTimetableSlot,
    swapTimetableSlots,
    getDailyTimetable,
    getUnassignedWorkloads,
    getSlotSuggestions,
    getTimetableHistory,
    regenerateDailyTimetable,
    getDailyRegenerationHistory,
    toggleHiddenSlot,
    getGapAnalysis,
    cancelGeneration,
    activateTimetableHistory
} from '../controllers/timetableController.js';
import { protect, requireRole, departmentScope } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(protect);
router.use(departmentScope);

router.get('/schema', getTimetableSchema);
router.get('/daily', getDailyTimetable);
router.get('/daily-history', getDailyRegenerationHistory);
router.get('/unassigned', getUnassignedWorkloads);
router.get('/suggestions', getSlotSuggestions);
router.get('/gap-analysis', getGapAnalysis);
router.get('/history', getTimetableHistory);
router.get('/', getTimetable);
router.post('/', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), createTimetableSlot);
router.post('/generate', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), generateTimetable);
router.post('/analyze-pre-generation', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), analyzePreGeneration);
router.post('/regenerate-daily', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), regenerateDailyTimetable);
router.post('/validate', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), validateMove);
router.post('/swap', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), swapTimetableSlots);
router.put('/:id', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), updateTimetableSlot);
router.patch('/:id/toggle-hidden', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), toggleHiddenSlot);
router.delete('/:id', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), deleteTimetableSlot);
router.post('/cancel', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), cancelGeneration);
router.post('/activate/:batch_id', requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'), activateTimetableHistory);

export default router;
