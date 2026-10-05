import express from 'express';
import { protect, requireRole, departmentScope } from '../middlewares/authMiddleware.js';
import { 
    getAllotments, 
    createAllotment, 
    updateAllotment, 
    deleteAllotment 
} from '../controllers/libraryAllotmentController.js';

const router = express.Router();

router.use(protect);
router.use(requireRole('SUPER_ADMIN', 'DEPARTMENT_ADMIN'));
router.use(departmentScope);

router.get('/', getAllotments);
router.post('/', createAllotment);
router.put('/:id', updateAllotment);
router.delete('/:id', deleteAllotment);

export default router;
