import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../utils/api';
import { toast } from 'react-toastify';

const Messages = () => {
    const { user } = useAuth();
    const [contacts, setContacts] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [messages, setMessages] = useState([]);
    const [selectedContact, setSelectedContact] = useState(null);
    const [messageText, setMessageText] = useState('');
    const [editingMessageId, setEditingMessageId] = useState(null);
    const [loading, setLoading] = useState(false);
    const [openDropdownId, setOpenDropdownId] = useState(null);
    const [messageDropdownId, setMessageDropdownId] = useState(null);
    
    const chatContainerRef = useRef(null);

    // Fetch Contacts
    const fetchContacts = async () => {
        try {
            const res = await api.get('/messages/contacts');
            setContacts(res.data);
            
            // update selected contact if its details changed
            if (selectedContact) {
                const updated = res.data.find(c => c.id === selectedContact.id);
                if (updated) setSelectedContact(updated);
            }
        } catch (err) {
            console.error("Error fetching contacts:", err);
        }
    };

    useEffect(() => {
        if (user) {
            fetchContacts();
            const interval = setInterval(fetchContacts, 15000);
            return () => clearInterval(interval);
        }
    }, [user]);

    // Click outside handler for dropdowns
    useEffect(() => {
        const handleClickOutside = () => {
            setOpenDropdownId(null);
            setMessageDropdownId(null);
        };
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, []);

    // Fetch Messages when contact is selected
    const fetchMessages = async (contactId) => {
        try {
            setLoading(true);
            const res = await api.get(`/messages/${contactId}`);
            setMessages(res.data);
            scrollToBottom();
            fetchContacts();
        } catch (err) {
            console.error("Error fetching messages:", err);
            toast.error("Failed to load messages.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (selectedContact) {
            fetchMessages(selectedContact.id);
            const interval = setInterval(() => {
                api.get(`/messages/${selectedContact.id}`).then(res => setMessages(res.data));
            }, 10000);
            return () => clearInterval(interval);
        } else {
            setMessages([]);
        }
    }, [selectedContact?.id]);

    const scrollToBottom = () => {
        setTimeout(() => {
            if (chatContainerRef.current) {
                chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
            }
        }, 100);
    };

    const handleSend = async (e) => {
        e.preventDefault();
        if (!messageText.trim() || !selectedContact) return;

        try {
            if (editingMessageId) {
                await api.put(`/messages/${editingMessageId}`, { newText: messageText });
                setMessages(prev => prev.map(msg => 
                    msg.id === editingMessageId ? { ...msg, message: messageText, is_edited: 1 } : msg
                ));
                setEditingMessageId(null);
                toast.success('Message updated');
            } else {
                const res = await api.post('/messages', {
                    receiverId: selectedContact.id,
                    message: messageText
                });
                setMessages(prev => [...prev, res.data]);
                scrollToBottom();
                fetchContacts(); 
            }
            setMessageText('');
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to send message');
        }
    };

    const handleEditClick = (msg) => {
        setEditingMessageId(msg.id);
        setMessageText(msg.message);
    };

    const cancelEdit = () => {
        setEditingMessageId(null);
        setMessageText('');
    };

    const handleDelete = async (id, type) => {
        if (!window.confirm(`Are you sure you want to delete this message ${type === 'everyone' ? 'for everyone' : 'for me'}?`)) return;
        try {
            await api.delete(`/messages/${id}?type=${type}`);
            if (type === 'everyone') {
                setMessages(prev => prev.map(msg => msg.id === id ? { ...msg, is_deleted_for_everyone: 1 } : msg));
            } else {
                setMessages(prev => prev.filter(msg => msg.id !== id));
            }
            toast.success("Message deleted");
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to delete message');
        }
    };

    const handlePin = async (id, currentStatus) => {
        try {
            await api.patch(`/messages/${id}/pin`, { isPinned: !currentStatus });
            setMessages(prev => prev.map(msg => 
                msg.id === id ? { ...msg, is_pinned: !currentStatus ? 1 : 0 } : msg
            ));
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to pin/unpin message');
        }
    };

    const handleChatSetting = async (contactId, setting, value) => {
        try {
            await api.post(`/messages/settings/${contactId}`, { [setting]: value });
            toast.success(`Chat setting updated`);
            fetchContacts();
        } catch (err) {
            toast.error('Failed to update setting');
        }
    };

    const handleClearChat = async (contactId) => {
        if (!window.confirm("Are you sure you want to clear this entire chat? This action cannot be undone for you.")) return;
        try {
            await api.delete(`/messages/chat/${contactId}`);
            setMessages([]);
            toast.success("Chat cleared");
            fetchContacts();
        } catch (err) {
            toast.error('Failed to clear chat');
        }
    };

    const handleMarkUnread = async (contactId) => {
        try {
            await api.patch(`/messages/chat/${contactId}/unread`);
            toast.success("Marked as unread");
            fetchContacts();
        } catch (err) {
            toast.error('Failed to mark unread');
        }
    };

    const isEditable = (createdAt) => {
        const diffMinutes = (new Date().getTime() - new Date(createdAt).getTime()) / (1000 * 60);
        return diffMinutes <= 30;
    };
    
    const isDeletableForEveryone = (createdAt) => {
        const diffMinutes = (new Date().getTime() - new Date(createdAt).getTime()) / (1000 * 60);
        return diffMinutes <= 60;
    };

    const formatTime = (dateString) => {
        return new Date(dateString).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    };

    const filteredContacts = contacts.filter(c => {
        const q = searchQuery.toLowerCase();
        return (c.name?.toLowerCase().includes(q) || 
                c.username?.toLowerCase().includes(q) || 
                c.department?.toLowerCase().includes(q) || 
                c.role?.toLowerCase().includes(q));
    });

    return (
        <div className="container-fluid py-4" style={{ height: 'calc(100vh - var(--navbar-height))', display: 'flex', flexDirection: 'column' }}>
            <div className="row g-3 flex-grow-1 overflow-hidden">
                {/* Contacts Sidebar */}
                <div className={`col-12 col-md-4 col-lg-4 h-100 ${selectedContact ? 'd-none d-md-block' : 'd-block'}`}>
                    <div className="card shadow-sm h-100 border-0" style={{ background: 'var(--app-surface)', borderRadius: 'var(--radius-lg)' }}>
                        <div className="card-header border-bottom py-3" style={{ background: 'transparent', borderColor: 'var(--app-border) !important' }}>
                            <div className="input-group" style={{ background: 'var(--app-bg)', borderRadius: 'var(--radius-full)', padding: '4px', border: '1px solid var(--app-border)' }}>
                                <span className="input-group-text border-0 bg-transparent" style={{ color: 'var(--text-muted)' }}>
                                    <i className="bi bi-search"></i>
                                </span>
                                <input 
                                    type="text" 
                                    className="form-control border-0 bg-transparent shadow-none" 
                                    placeholder="Search name, username, department..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    style={{ color: 'var(--text-primary)' }}
                                />
                            </div>
                        </div>
                        <div className="list-group list-group-flush overflow-auto flex-grow-1" style={{ borderRadius: '0 0 var(--radius-lg) var(--radius-lg)' }}>
                            {filteredContacts.map(c => {
                                const isActive = selectedContact?.id === c.id;
                                const isMenuOpen = openDropdownId === c.id;
                                return (
                                    <div 
                                        key={c.id} 
                                        className={`list-group-item list-group-item-action py-3 border-0 border-bottom position-relative d-flex`}
                                        onClick={() => { setSelectedContact(c); cancelEdit(); }}
                                        style={{ 
                                            background: isActive ? 'var(--primary-500)' : 'transparent',
                                            borderColor: 'var(--app-border) !important',
                                            color: isActive ? '#fff' : 'var(--text-primary)',
                                            transition: 'var(--transition-fast)',
                                            cursor: 'pointer',
                                            opacity: c.isArchived ? 0.7 : 1
                                        }}
                                    >
                                        <div className="position-relative">
                                            <div className="rounded-circle d-flex justify-content-center align-items-center me-3" 
                                                style={{ 
                                                    width: '45px', height: '45px', 
                                                    background: isActive ? 'rgba(255,255,255,0.2)' : 'var(--primary-100)',
                                                    color: isActive ? '#fff' : 'var(--primary-700)',
                                                    fontWeight: 'bold', fontSize: '1rem'
                                                }}>
                                                {c.initial}
                                            </div>
                                            {c.unreadCount > 0 && !isActive && (
                                                <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger shadow-sm border border-white">
                                                    {c.unreadCount}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex-grow-1 text-start overflow-hidden pe-2">
                                            <div className="d-flex justify-content-between align-items-center mb-1">
                                                <h6 className="mb-0 fw-bold text-truncate d-flex align-items-center gap-1" style={{ color: isActive ? '#fff' : 'var(--text-primary)' }}>
                                                    {c.isFavourite && <i className="bi bi-star-fill text-warning" style={{ fontSize: '0.8rem' }}></i>}
                                                    {c.name}
                                                </h6>
                                                {c.lastMessageTime && (
                                                    <small style={{ color: isActive ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)', fontSize: '0.65rem', whiteSpace: 'nowrap' }}>
                                                        {formatTime(c.lastMessageTime)}
                                                    </small>
                                                )}
                                            </div>
                                            <div className="d-flex justify-content-between align-items-center mb-1">
                                                <small className="text-truncate" style={{ color: isActive ? 'rgba(255,255,255,0.8)' : 'var(--text-secondary)', fontSize: '0.75rem', maxWidth: '100%' }}>
                                                    @{c.username} • {c.department || c.role}
                                                </small>
                                            </div>
                                            <div className="d-flex justify-content-between align-items-center">
                                                <small className="text-truncate d-block" style={{ color: isActive ? 'rgba(255,255,255,0.9)' : (c.unreadCount > 0 ? 'var(--text-primary)' : 'var(--text-muted)'), fontSize: '0.8rem', fontWeight: c.unreadCount > 0 && !isActive ? '600' : 'normal', maxWidth: '85%' }}>
                                                    {c.isBlocked ? <span className="text-danger"><i className="bi bi-slash-circle me-1"></i>Blocked</span> : 
                                                     (c.lastMessage ? (c.is_deleted_for_everyone ? <i><i className="bi bi-slash-circle"></i> This message was deleted</i> : c.lastMessage) : <span className="opacity-75 fst-italic">Say hi!</span>)}
                                                </small>
                                            </div>
                                        </div>
                                        
                                        {/* Contact Action Menu */}
                                        <div className="position-relative">
                                            <button 
                                                className="btn btn-sm" 
                                                style={{ color: isActive ? 'white' : 'var(--text-muted)' }} 
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setOpenDropdownId(isMenuOpen ? null : c.id);
                                                    setMessageDropdownId(null);
                                                }}
                                            >
                                                <i className="bi bi-three-dots-vertical"></i>
                                            </button>
                                            {isMenuOpen && (
                                                <div 
                                                    className="dropdown-menu show shadow-sm border-0 position-absolute" 
                                                    style={{ right: '0', top: '100%', fontSize: '0.85rem', zIndex: 1000 }}
                                                >
                                                    <button className="dropdown-item" onClick={(e) => { e.stopPropagation(); handleChatSetting(c.id, 'is_favourite', !c.isFavourite); setOpenDropdownId(null); }}>
                                                        {c.isFavourite ? 'Remove from Favourites' : 'Add to Favourites'}
                                                    </button>
                                                    <button className="dropdown-item" onClick={(e) => { e.stopPropagation(); handleMarkUnread(c.id); setOpenDropdownId(null); }}>Mark as Unread</button>
                                                    <button className="dropdown-item" onClick={(e) => { e.stopPropagation(); handleChatSetting(c.id, 'is_archived', !c.isArchived); setOpenDropdownId(null); }}>
                                                        {c.isArchived ? 'Unarchive Chat' : 'Archive Chat'}
                                                    </button>
                                                    <hr className="dropdown-divider" />
                                                    <button className="dropdown-item text-danger" onClick={(e) => { e.stopPropagation(); handleClearChat(c.id); setOpenDropdownId(null); }}>Clear Chat</button>
                                                    <button className="dropdown-item text-danger" onClick={(e) => { e.stopPropagation(); handleChatSetting(c.id, 'is_blocked', !c.isBlocked); setOpenDropdownId(null); }}>
                                                        {c.isBlocked ? 'Unblock User' : 'Block User'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            {filteredContacts.length === 0 && (
                                <div className="p-4 text-center text-muted">No contacts found.</div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Chat Area */}
                <div className={`col-12 col-md-8 col-lg-8 h-100 ${selectedContact ? 'd-block' : 'd-none d-md-block'}`}>
                    <div className="card shadow-sm h-100 border-0 d-flex flex-column" style={{ background: 'var(--app-surface)', borderRadius: 'var(--radius-lg)' }}>
                        {selectedContact ? (
                            <>
                                {/* Chat Header */}
                                <div className="card-header border-bottom py-3 d-flex align-items-center" style={{ background: 'transparent', borderColor: 'var(--app-border) !important' }}>
                                    <button 
                                        className="btn btn-link p-0 me-2 d-md-none" 
                                        onClick={() => setSelectedContact(null)}
                                        style={{ color: 'var(--text-primary)' }}
                                    >
                                        <i className="bi bi-arrow-left fs-5"></i>
                                    </button>
                                    <div className="rounded-circle d-flex justify-content-center align-items-center me-3" 
                                        style={{ width: '45px', height: '45px', background: 'var(--primary-500)', color: '#fff', fontSize: '1rem', fontWeight: 'bold', flexShrink: 0 }}>
                                        {selectedContact.initial}
                                    </div>
                                    <div className="flex-grow-1 overflow-hidden">
                                        <h5 className="mb-0 fw-bold text-truncate" style={{ color: 'var(--text-primary)' }}>
                                            {selectedContact.name} {selectedContact.isFavourite && <i className="bi bi-star-fill text-warning ms-1" style={{ fontSize: '0.9rem' }}></i>}
                                        </h5>
                                        <small className="text-truncate d-block" style={{ color: 'var(--text-muted)' }}>
                                            @{selectedContact.username} • {selectedContact.department || selectedContact.role}
                                            <span className="d-none d-lg-inline">
                                                {selectedContact.designation ? ` • ${selectedContact.designation}` : ''}
                                            </span>
                                        </small>
                                    </div>
                                </div>
                                
                                {/* Chat Messages */}
                                <div className="card-body flex-grow-1 overflow-auto p-4" ref={chatContainerRef} style={{ background: 'var(--app-bg)' }}>
                                    {selectedContact.isArchived && (
                                        <div className="text-center mb-4">
                                            <span className="badge bg-secondary rounded-pill">This chat is archived</span>
                                        </div>
                                    )}
                                    
                                    {loading && messages.length === 0 ? (
                                        <div className="text-center text-muted py-5">Loading messages...</div>
                                    ) : messages.length === 0 ? (
                                        <div className="text-center text-muted py-5">No messages yet. Say hi!</div>
                                    ) : (
                                        messages.map((msg, index) => {
                                            const isMine = msg.sender_id === user.id;
                                            const isDeletedForEveryone = !!msg.is_deleted_for_everyone;
                                            const msgStyle = msg.is_pinned ? { border: '1px solid var(--warning)', boxShadow: '0 0 10px rgba(245, 158, 11, 0.2)' } : { border: '1px solid var(--app-border)' };

                                            return (
                                                <div key={msg.id} className={`d-flex mb-4 ${isMine ? 'justify-content-end' : ''}`}>
                                                    {!isMine && (
                                                        <div className="rounded-circle d-flex justify-content-center align-items-center me-2 mt-auto shadow-sm" style={{ width: '28px', height: '28px', background: 'var(--primary-100)', color: 'var(--primary-700)', fontSize: '0.7rem', fontWeight: 'bold', flexShrink: 0 }}>
                                                            {selectedContact.initial}
                                                        </div>
                                                    )}
                                                    
                                                    <div className="d-flex flex-column" style={{ maxWidth: '80%' }}>
                                                        <div className="rounded p-3 shadow-sm position-relative" 
                                                            style={{ 
                                                                background: isMine ? (isDeletedForEveryone ? 'var(--primary-200)' : 'var(--primary-500)') : (isDeletedForEveryone ? 'var(--app-bg)' : 'var(--app-surface)'), 
                                                                color: isMine ? (isDeletedForEveryone ? 'var(--text-secondary)' : '#fff') : (isDeletedForEveryone ? 'var(--text-muted)' : 'var(--text-primary)'),
                                                                borderBottomRightRadius: isMine ? '0 !important' : 'var(--radius-md)',
                                                                borderBottomLeftRadius: !isMine ? '0 !important' : 'var(--radius-md)',
                                                                fontStyle: isDeletedForEveryone ? 'italic' : 'normal',
                                                                ...msgStyle
                                                            }}>
                                                            
                                                            {msg.is_pinned && !isDeletedForEveryone ? (
                                                                <div className="mb-1 d-flex align-items-center" style={{ fontSize: '0.7rem', color: isMine ? 'rgba(255,255,255,0.8)' : 'var(--warning-dark)', fontWeight: 'bold' }}>
                                                                    <i className="bi bi-pin-angle-fill me-1"></i> Pinned
                                                                </div>
                                                            ) : null}

                                                            <p className="mb-1" style={{ fontSize: '0.95rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', opacity: isDeletedForEveryone ? 0.7 : 1 }}>
                                                                {isDeletedForEveryone ? <><i className="bi bi-slash-circle me-1"></i> This message was deleted</> : msg.message}
                                                            </p>
                                                            
                                                            <div className="d-flex justify-content-between align-items-center mt-2">
                                                                <small style={{ color: isMine ? (isDeletedForEveryone ? 'var(--text-muted)' : 'rgba(255,255,255,0.7)') : 'var(--text-muted)', fontSize: '0.7rem', display: 'flex', alignItems: 'center' }}>
                                                                    {formatTime(msg.created_at)}
                                                                    {msg.is_edited && !isDeletedForEveryone ? <span className="ms-1">(edited)</span> : null}
                                                                    {isMine && !isDeletedForEveryone && (
                                                                        <span className="ms-1" style={{ fontSize: '1rem', lineHeight: 1 }}>
                                                                            {msg.is_read ? (
                                                                                <i className="bi bi-check-all" style={{ color: '#38bdf8', textShadow: '0 0 2px rgba(0,0,0,0.1)' }}></i>
                                                                            ) : msg.is_delivered ? (
                                                                                <i className="bi bi-check-all" style={{ opacity: 0.7 }}></i>
                                                                            ) : (
                                                                                <i className="bi bi-check" style={{ opacity: 0.7, fontSize: '1.2rem', marginLeft: '-2px' }}></i>
                                                                            )}
                                                                        </span>
                                                                    )}
                                                                </small>
                                                                
                                                                {!isDeletedForEveryone && (
                                                                    <div className="position-relative ms-3">
                                                                        <button 
                                                                            className="btn btn-sm p-0 border-0" 
                                                                            style={{ color: isMine ? 'rgba(255,255,255,0.8)' : 'var(--text-secondary)', opacity: 0.7 }}
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                setMessageDropdownId(messageDropdownId === msg.id ? null : msg.id);
                                                                                setOpenDropdownId(null);
                                                                            }}
                                                                        >
                                                                            <i className="bi bi-chevron-down"></i>
                                                                        </button>
                                                                        {messageDropdownId === msg.id && (
                                                                            <div className="dropdown-menu show shadow-sm border-0 position-absolute" style={{ right: 0, top: '100%', fontSize: '0.85rem', zIndex: 1000 }}>
                                                                                <button className="dropdown-item" onClick={(e) => { e.stopPropagation(); handlePin(msg.id, msg.is_pinned); setMessageDropdownId(null); }}>
                                                                                    {msg.is_pinned ? 'Unpin Message' : 'Pin Message'}
                                                                                </button>
                                                                                {isMine && isEditable(msg.created_at) && (
                                                                                    <button className="dropdown-item" onClick={(e) => { e.stopPropagation(); handleEditClick(msg); setMessageDropdownId(null); }}>
                                                                                        Edit Message
                                                                                    </button>
                                                                                )}
                                                                                <button className="dropdown-item text-danger" onClick={(e) => { e.stopPropagation(); handleDelete(msg.id, 'me'); setMessageDropdownId(null); }}>
                                                                                    Delete for Me
                                                                                </button>
                                                                                {isMine && isDeletableForEveryone(msg.created_at) && (
                                                                                    <button className="dropdown-item text-danger" onClick={(e) => { e.stopPropagation(); handleDelete(msg.id, 'everyone'); setMessageDropdownId(null); }}>
                                                                                        Delete for Everyone
                                                                                    </button>
                                                                                )}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                                
                                {/* Chat Input */}
                                <div className="card-footer border-top p-3" style={{ background: 'var(--app-surface)', borderColor: 'var(--app-border) !important' }}>
                                    {selectedContact.isBlocked ? (
                                        <div className="text-center p-2 text-danger fw-bold">
                                            <i className="bi bi-slash-circle me-2"></i>You have blocked this contact.
                                        </div>
                                    ) : (
                                        <>
                                            {editingMessageId && (
                                                <div className="mb-2 d-flex justify-content-between align-items-center p-2 rounded" style={{ background: 'var(--warning-light)', color: 'var(--warning-dark)', fontSize: '0.8rem' }}>
                                                    <span><i className="bi bi-pencil-fill me-2"></i> Editing message...</span>
                                                    <button className="btn btn-sm btn-link text-danger p-0 text-decoration-none" onClick={cancelEdit}>Cancel</button>
                                                </div>
                                            )}
                                            <form onSubmit={handleSend} className="d-flex gap-2 align-items-center">
                                                <div className="input-group" style={{ flexGrow: 1, background: 'var(--app-bg)', borderRadius: 'var(--radius-full)', padding: '4px', border: '1px solid var(--app-border)' }}>
                                                    <input 
                                                        type="text" 
                                                        className="form-control border-0 bg-transparent shadow-none px-4" 
                                                        placeholder={`Message ${selectedContact.name}...`}
                                                        value={messageText}
                                                        onChange={(e) => setMessageText(e.target.value)}
                                                        style={{ color: 'var(--text-primary)' }}
                                                    />
                                                </div>
                                                <button type="submit" className="btn btn-primary rounded-circle d-flex justify-content-center align-items-center shadow-sm" style={{ width: '48px', height: '48px', flexShrink: 0, transition: 'var(--transition-fast)' }} disabled={!messageText.trim()}>
                                                    <i className="bi bi-send-fill"></i>
                                                </button>
                                            </form>
                                        </>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="d-flex flex-column justify-content-center align-items-center h-100 p-5 text-center" style={{ background: 'var(--app-bg)', borderRadius: 'var(--radius-lg)' }}>
                                <div className="rounded-circle d-flex justify-content-center align-items-center mb-4 shadow-sm" style={{ width: '100px', height: '100px', background: 'var(--app-surface)' }}>
                                    <i className="bi bi-chat-dots" style={{ fontSize: '3rem', color: 'var(--primary-400)' }}></i>
                                </div>
                                <h4 className="fw-bold" style={{ color: 'var(--text-primary)' }}>Contact Messages</h4>
                                <p style={{ color: 'var(--text-secondary)', maxWidth: '400px' }}>Select a contact from the left panel to start messaging. You can search by name, username, or department.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Messages;
