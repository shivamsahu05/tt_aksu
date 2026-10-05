import db from '../config/db.js';

export const getContacts = async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;
        const departmentId = req.user.department_id;

        let query = '';
        let params = [];

        // Mark all incoming messages as delivered since the user is online
        await db.query('UPDATE messages SET is_delivered = TRUE WHERE receiver_id = ? AND is_delivered = FALSE', [userId]);

        // Join with teachers, departments, and chat_settings
        const selectClause = `
            SELECT 
                u.id, 
                u.username, 
                u.role, 
                u.email,
                t.full_name as teacher_name,
                t.designation,
                d.name as department_name,
                cs.is_favourite,
                cs.is_blocked,
                cs.is_archived
            FROM users u
            LEFT JOIN teachers t ON u.teacher_id = t.id
            LEFT JOIN departments d ON u.department_id = d.id
            LEFT JOIN chat_settings cs ON cs.user_id = ? AND cs.contact_id = u.id
            WHERE u.id != ? AND u.is_active = 1
        `;

        if (role === 'SUPER_ADMIN') {
            query = selectClause;
            params = [userId, userId];
        } else if (role === 'DEPARTMENT_ADMIN') {
            query = selectClause + ` AND (u.role = 'SUPER_ADMIN' OR u.role = 'DEPARTMENT_ADMIN' OR u.department_id = ?)`;
            params = [userId, userId, departmentId];
        } else if (role === 'FACULTY') {
            query = selectClause + ` AND (u.role = 'SUPER_ADMIN' OR (u.role = 'DEPARTMENT_ADMIN' AND u.department_id = ?))`;
            params = [userId, userId, departmentId];
        }

        const [users] = await db.query(query, params);

        const [messages] = await db.query(`
            SELECT sender_id, receiver_id, message, created_at, is_read, deleted_by_sender, deleted_by_receiver, is_deleted_for_everyone
            FROM messages 
            WHERE sender_id = ? OR receiver_id = ?
            ORDER BY created_at DESC
        `, [userId, userId]);

        const formattedContacts = users.map(c => {
            // Filter out messages deleted by this user
            const contactMessages = messages.filter(m => {
                if (m.sender_id === userId && m.receiver_id === c.id) return !m.deleted_by_sender;
                if (m.sender_id === c.id && m.receiver_id === userId) return !m.deleted_by_receiver;
                return false;
            });
            
            const lastMessage = contactMessages.length > 0 ? contactMessages[0] : null;
            const unreadCount = contactMessages.filter(m => m.sender_id === c.id && m.receiver_id === userId && !m.is_read).length;
            
            // Generate full name fallback
            let displayName = c.username;
            if (c.role === 'SUPER_ADMIN') {
                displayName = 'Super Admin';
            } else if (c.teacher_name) {
                displayName = c.teacher_name;
            } else if (c.role === 'DEPARTMENT_ADMIN' && c.department_name) {
                displayName = c.department_name + ' Admin';
            }

            return {
                id: c.id,
                username: c.username,
                name: displayName,
                role: c.role === 'SUPER_ADMIN' ? 'System Administrator' : (c.role === 'DEPARTMENT_ADMIN' ? 'Department Admin' : 'Faculty Member'),
                department: c.department_name || '',
                designation: c.designation || '',
                initial: displayName.substring(0, 2).toUpperCase(),
                lastMessage: lastMessage ? lastMessage.message : null,
                lastMessageTime: lastMessage ? lastMessage.created_at : null,
                unreadCount,
                isFavourite: !!c.is_favourite,
                isBlocked: !!c.is_blocked,
                isArchived: !!c.is_archived
            };
        });

        formattedContacts.sort((a, b) => {
            if (!a.lastMessageTime && !b.lastMessageTime) return 0;
            if (!a.lastMessageTime) return 1;
            if (!b.lastMessageTime) return -1;
            return new Date(b.lastMessageTime) - new Date(a.lastMessageTime);
        });

        res.json(formattedContacts);
    } catch (error) {
        console.error('Error fetching contacts:', error);
        res.status(500).json({ message: 'Server error fetching contacts' });
    }
};

export const getMessages = async (req, res) => {
    try {
        const userId = req.user.id;
        const { contactId } = req.params;

        // Note: we don't auto mark as read here if they want manual toggle,
        // but traditionally we mark it as read when opened. I'll keep it auto read, 
        // and also allow manual toggle via another endpoint.
        await db.query(`
            UPDATE messages SET is_read = TRUE, is_delivered = TRUE 
            WHERE sender_id = ? AND receiver_id = ? AND is_read = FALSE
        `, [contactId, userId]);

        const [messages] = await db.query(`
            SELECT * FROM messages 
            WHERE ((sender_id = ? AND receiver_id = ? AND deleted_by_sender = FALSE) 
               OR (sender_id = ? AND receiver_id = ? AND deleted_by_receiver = FALSE))
            ORDER BY created_at ASC
        `, [userId, contactId, contactId, userId]);

        res.json(messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ message: 'Server error fetching messages' });
    }
};

export const sendMessage = async (req, res) => {
    try {
        const senderId = req.user.id;
        const senderName = req.user.username;
        const { receiverId, message } = req.body;

        if (!receiverId || !message || message.trim() === '') {
            return res.status(400).json({ message: 'Receiver and message text are required' });
        }

        // Check if blocked
        const [blockCheck] = await db.query('SELECT is_blocked FROM chat_settings WHERE user_id = ? AND contact_id = ?', [receiverId, senderId]);
        if (blockCheck.length > 0 && blockCheck[0].is_blocked) {
            return res.status(403).json({ message: 'You have been blocked by this user.' });
        }

        const [result] = await db.query(`
            INSERT INTO messages (sender_id, receiver_id, message) 
            VALUES (?, ?, ?)
        `, [senderId, receiverId, message]);

        const [newMessage] = await db.query('SELECT * FROM messages WHERE id = ?', [result.insertId]);

        const title = `New Message from ${senderName}`;
        let snippet = message.length > 30 ? message.substring(0, 30) + '...' : message;
        await db.query(`
            INSERT INTO notifications (user_id, title, message, type)
            VALUES (?, ?, ?, ?)
        `, [receiverId, title, snippet, 'system']);

        res.status(201).json(newMessage[0]);
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ message: 'Server error sending message' });
    }
};

export const editMessage = async (req, res) => {
    try {
        const userId = req.user.id;
        const { messageId } = req.params;
        const { newText } = req.body;

        if (!newText || newText.trim() === '') return res.status(400).json({ message: 'Message text cannot be empty' });

        const [msgRows] = await db.query('SELECT * FROM messages WHERE id = ?', [messageId]);
        if (msgRows.length === 0) return res.status(404).json({ message: 'Message not found' });

        const msg = msgRows[0];
        if (msg.sender_id !== userId) return res.status(403).json({ message: 'You can only edit your own messages' });

        const diffMinutes = (new Date().getTime() - new Date(msg.created_at).getTime()) / (1000 * 60);
        if (diffMinutes > 30) return res.status(403).json({ message: 'Messages can only be edited within 30 minutes of sending' });

        await db.query('UPDATE messages SET message = ?, is_edited = TRUE WHERE id = ?', [newText, messageId]);
        res.json({ message: 'Message updated successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Server error editing message' });
    }
};

export const deleteMessage = async (req, res) => {
    try {
        const userId = req.user.id;
        const { messageId } = req.params;
        const { type } = req.query; // 'everyone' or 'me'

        const [msgRows] = await db.query('SELECT * FROM messages WHERE id = ?', [messageId]);
        if (msgRows.length === 0) return res.status(404).json({ message: 'Message not found' });

        const msg = msgRows[0];
        
        if (type === 'everyone') {
            if (msg.sender_id !== userId) {
                return res.status(403).json({ message: 'You can only delete your own messages for everyone' });
            }
            // Check time limit for delete for everyone (e.g. 1 hour)
            const diffMinutes = (new Date().getTime() - new Date(msg.created_at).getTime()) / (1000 * 60);
            if (diffMinutes > 60) {
                return res.status(403).json({ message: 'Cannot delete for everyone after 1 hour' });
            }
            await db.query('UPDATE messages SET is_deleted_for_everyone = TRUE WHERE id = ?', [messageId]);
        } else {
            // Delete for me
            if (msg.sender_id === userId) {
                await db.query('UPDATE messages SET deleted_by_sender = TRUE WHERE id = ?', [messageId]);
            } else if (msg.receiver_id === userId) {
                await db.query('UPDATE messages SET deleted_by_receiver = TRUE WHERE id = ?', [messageId]);
            } else {
                return res.status(403).json({ message: 'You can only delete your own messages' });
            }
        }

        res.json({ message: 'Message deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Server error deleting message' });
    }
};

export const pinMessage = async (req, res) => {
    try {
        const userId = req.user.id;
        const { messageId } = req.params;
        const { isPinned } = req.body;

        const [msgRows] = await db.query('SELECT * FROM messages WHERE id = ?', [messageId]);
        if (msgRows.length === 0) return res.status(404).json({ message: 'Message not found' });
        
        const msg = msgRows[0];
        if (msg.sender_id !== userId && msg.receiver_id !== userId) {
            return res.status(403).json({ message: 'Not authorized to pin this message' });
        }

        await db.query('UPDATE messages SET is_pinned = ? WHERE id = ?', [isPinned, messageId]);
        res.json({ message: `Message ${isPinned ? 'pinned' : 'unpinned'} successfully` });
    } catch (error) {
        res.status(500).json({ message: 'Server error pinning message' });
    }
};

export const updateChatSettings = async (req, res) => {
    try {
        const userId = req.user.id;
        const { contactId } = req.params;
        const { is_favourite, is_blocked, is_archived } = req.body;

        // Check if row exists
        const [rows] = await db.query('SELECT * FROM chat_settings WHERE user_id = ? AND contact_id = ?', [userId, contactId]);
        
        if (rows.length === 0) {
            await db.query(`
                INSERT INTO chat_settings (user_id, contact_id, is_favourite, is_blocked, is_archived) 
                VALUES (?, ?, IFNULL(?, FALSE), IFNULL(?, FALSE), IFNULL(?, FALSE))
            `, [userId, contactId, is_favourite, is_blocked, is_archived]);
        } else {
            let updates = [];
            let params = [];
            if (is_favourite !== undefined) { updates.push('is_favourite = ?'); params.push(is_favourite); }
            if (is_blocked !== undefined) { updates.push('is_blocked = ?'); params.push(is_blocked); }
            if (is_archived !== undefined) { updates.push('is_archived = ?'); params.push(is_archived); }
            
            if (updates.length > 0) {
                params.push(userId, contactId);
                await db.query(`UPDATE chat_settings SET ${updates.join(', ')} WHERE user_id = ? AND contact_id = ?`, params);
            }
        }
        res.json({ message: 'Settings updated' });
    } catch (error) {
        console.error('Error updating chat settings:', error);
        res.status(500).json({ message: 'Server error updating settings' });
    }
};

export const clearChat = async (req, res) => {
    try {
        const userId = req.user.id;
        const { contactId } = req.params;

        // Update messages where user is sender
        await db.query('UPDATE messages SET deleted_by_sender = TRUE WHERE sender_id = ? AND receiver_id = ?', [userId, contactId]);
        // Update messages where user is receiver
        await db.query('UPDATE messages SET deleted_by_receiver = TRUE WHERE receiver_id = ? AND sender_id = ?', [userId, contactId]);

        res.json({ message: 'Chat cleared successfully' });
    } catch (error) {
        console.error('Error clearing chat:', error);
        res.status(500).json({ message: 'Server error clearing chat' });
    }
};

export const markAsUnread = async (req, res) => {
    try {
        const userId = req.user.id;
        const { contactId } = req.params;
        
        // Find latest message from contact and mark it unread
        await db.query(`
            UPDATE messages SET is_read = FALSE 
            WHERE sender_id = ? AND receiver_id = ? 
            ORDER BY created_at DESC LIMIT 1
        `, [contactId, userId]);
        
        res.json({ message: 'Marked as unread' });
    } catch (error) {
        res.status(500).json({ message: 'Server error marking unread' });
    }
};
