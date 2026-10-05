import express from 'express';
import { protect } from '../middlewares/authMiddleware.js';
import { 
    getContacts, 
    getMessages, 
    sendMessage, 
    editMessage, 
    deleteMessage, 
    pinMessage,
    updateChatSettings,
    clearChat,
    markAsUnread
} from '../controllers/messageController.js';

const router = express.Router();

router.use(protect);

router.get('/contacts', getContacts);
router.get('/:contactId', getMessages);
router.post('/', sendMessage);
router.put('/:messageId', editMessage);
router.delete('/:messageId', deleteMessage);
router.patch('/:messageId/pin', pinMessage);

router.post('/settings/:contactId', updateChatSettings);
router.delete('/chat/:contactId', clearChat);
router.patch('/chat/:contactId/unread', markAsUnread);

export default router;
