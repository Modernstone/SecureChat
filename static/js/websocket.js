/**
 * SecureChat WebSocket Module
 * ============================
 * Manages the Socket.IO connection, handles events for messages,
 * typing indicators, online presence, and read receipts.
 */

const SecureChatSocket = (() => {
    'use strict';

    let socket = null;
    let currentUserId = null;
    let typingTimeout = null;
    const TYPING_TIMEOUT_MS = 3000;

    // Event handlers registered by chat.js
    const handlers = {
        onMessage: null,
        onTyping: null,
        onStopTyping: null,
        onUserOnline: null,
        onUserOffline: null,
        onReadReceipt: null,
        onConnect: null,
        onDisconnect: null
    };

    /**
     * Connect to the Socket.IO server.
     * @param {number} userId - The current user's ID.
     */
    function connect(userId) {
        currentUserId = userId;

        socket = io({
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000
        });

        socket.on('connect', () => {
            console.log('[WS] Connected, SID:', socket.id);
            socket.emit('user_connected', { user_id: currentUserId });
            if (handlers.onConnect) handlers.onConnect();
        });

        socket.on('disconnect', (reason) => {
            console.log('[WS] Disconnected:', reason);
            if (handlers.onDisconnect) handlers.onDisconnect(reason);
        });

        socket.on('new_message', (data) => {
            if (handlers.onMessage) handlers.onMessage(data);
        });

        socket.on('user_typing', (data) => {
            if (handlers.onTyping) handlers.onTyping(data);
        });

        socket.on('user_stop_typing', (data) => {
            if (handlers.onStopTyping) handlers.onStopTyping(data);
        });

        socket.on('user_online', (data) => {
            if (handlers.onUserOnline) handlers.onUserOnline(data);
        });

        socket.on('user_offline', (data) => {
            if (handlers.onUserOffline) handlers.onUserOffline(data);
        });

        socket.on('message_read', (data) => {
            if (handlers.onReadReceipt) handlers.onReadReceipt(data);
        });
    }

    /**
     * Send an encrypted message to a recipient.
     */
    function sendMessage(recipientId, encryptedMessage, encryptedSessionKey) {
        if (!socket || !socket.connected) {
            console.error('[WS] Not connected');
            return false;
        }
        socket.emit('send_message', {
            receiver_id: recipientId,
            encrypted_message: encryptedMessage,
            encrypted_session_key: encryptedSessionKey
        });
        return true;
    }

    /**
     * Emit a typing indicator for the given recipient.
     */
    function emitTyping(recipientId) {
        if (!socket) return;
        socket.emit('typing', { receiver_id: recipientId });
    }

    /**
     * Emit a stop-typing indicator.
     */
    function emitStopTyping(recipientId) {
        if (!socket) return;
        socket.emit('stop_typing', { receiver_id: recipientId });
    }

    /**
     * Mark a message as read.
     */
    function markRead(messageId, senderId) {
        if (!socket) return;
        socket.emit('mark_read', {
            message_id: messageId,
            sender_id: senderId
        });
    }

    /**
     * Register event handlers.
     */
    function on(eventName, callback) {
        const key = 'on' + capitalize(eventName);
        if (handlers.hasOwnProperty(key)) {
            handlers[key] = callback;
        }
    }

    /**
     * Start a typing debounce — emits typing, then auto-emits stop after delay.
     */
    function typingDebounce(recipientId) {
        emitTyping(recipientId);
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            emitStopTyping(recipientId);
        }, TYPING_TIMEOUT_MS);
    }

    /**
     * Disconnect from the server.
     */
    function disconnect() {
        if (socket) {
            socket.disconnect();
            socket = null;
        }
    }

    function capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    return {
        connect,
        disconnect,
        sendMessage,
        emitTyping,
        emitStopTyping,
        markRead,
        on,
        typingDebounce
    };
})();
