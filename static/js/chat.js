/**
 * SecureChat Chat Module
 * =======================
 * Orchestrates the chat UI: loads history, decrypts messages,
 * handles the send flow (encrypt then emit), and renders the conversation.
 */

(function () {
    'use strict';

    // ---------- DOM Elements ----------
    const container = document.querySelector('.chat-container');
    if (!container) return; // Not on chat page

    const myId = parseInt(container.dataset.myId, 10);
    const otherId = parseInt(container.dataset.otherId, 10);
    const otherName = container.dataset.otherName;
    const otherPublicKeyB64 = container.dataset.otherKey;

    const messagesArea = document.getElementById('messages-area');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const typingIndicator = document.getElementById('typing-indicator');
    const chatStatus = document.getElementById('chat-status');
    const loadingMessages = document.getElementById('loading-messages');
    const sendBtn = document.getElementById('send-btn');

    // State
    let myKeyPair = null;
    let otherPublicKey = null;
    let lastTypingEmit = 0;

    // ---------- Init ----------
    async function init() {
        try {
            // Load our keypair from IndexedDB
            myKeyPair = await SecureChatCrypto.getKeyPair();
            if (!myKeyPair) {
                showNotice('Your encryption keys are missing. Please re-login or re-register.');
                return;
            }

            // Import recipient's public key
            otherPublicKey = await SecureChatCrypto.importPublicKey(otherPublicKeyB64);

            // Connect WebSocket
            SecureChatSocket.connect(myId);
            setupSocketHandlers();

            // Load message history
            await loadHistory();
        } catch (err) {
            console.error('[Chat] Init error:', err);
            showNotice('Failed to initialize encryption. Please refresh.');
        }
    }

    // ---------- Load History ----------
    async function loadHistory() {
        try {
            const resp = await fetch('/api/messages/' + otherId);
            const data = await resp.json();
            loadingMessages.hidden = true;

            if (!data.messages || data.messages.length === 0) {
                showNotice('No messages yet. Say hello!');
                return;
            }

            for (const msg of data.messages) {
                await renderMessage(msg);
            }
            scrollToBottom();
        } catch (err) {
            loadingMessages.textContent = 'Failed to load messages.';
            console.error(err);
        }
    }

    // ---------- Render a Single Message ----------
    async function renderMessage(msg) {
        const isSent = msg.sender_id === myId;
        let plaintext;

        try {
            // Parse the session key bundle
            let sessionKeyBundle;
            try {
                sessionKeyBundle = JSON.parse(msg.encrypted_session_key);
            } catch {
                sessionKeyBundle = { for_recipient: msg.encrypted_session_key };
            }

            // Pick the correct encrypted session key for us
            const encryptedKeyForUs = isSent
                ? (sessionKeyBundle.for_sender || sessionKeyBundle.for_recipient)
                : (sessionKeyBundle.for_recipient || msg.encrypted_session_key);

            // Decrypt session key using our private key
            const sessionKey = await SecureChatCrypto.decryptSessionKey(
                encryptedKeyForUs,
                myKeyPair.privateKey
            );
            // Decrypt message
            plaintext = await SecureChatCrypto.decryptMessage(
                msg.encrypted_message,
                sessionKey
            );
        } catch (err) {
            plaintext = '[Unable to decrypt message — key mismatch]';
            console.warn('[Chat] Decrypt error for msg', msg.id, err);
        }

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble ' + (isSent ? 'message-sent' : 'message-received');
        bubble.dataset.messageId = msg.id;

        const time = new Date(msg.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });

        let readHtml = '';
        if (isSent && msg.read_at) {
            readHtml = '<span class="read-receipt" title="Read">&#10003;&#10003;</span>';
        } else if (isSent) {
            readHtml = '<span title="Sent">&#10003;</span>';
        }

        bubble.innerHTML =
            '<div class="message-text">' + escapeHtml(plaintext) + '</div>' +
            '<div class="message-meta">' +
                '<span class="message-time">' + time + '</span>' +
                readHtml +
            '</div>';

        messagesArea.appendChild(bubble);

        // Mark received unread messages as read
        if (!isSent && !msg.read_at) {
            SecureChatSocket.markRead(msg.id, msg.sender_id);
        }
    }

    // ---------- Send Message ----------
    messageForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const text = messageInput.value.trim();
        if (!text) return;

        messageInput.value = '';
        sendBtn.disabled = true;

        try {
            // Generate fresh session key
            const sessionKey = await SecureChatCrypto.generateSessionKey();

            // Encrypt the message with the session key
            const encryptedMessage = await SecureChatCrypto.encryptMessage(text, sessionKey);

            // Encrypt session key with recipient's public key
            const encryptedSessionKeyForRecipient = await SecureChatCrypto.encryptSessionKey(
                sessionKey, otherPublicKey
            );

            // Also encrypt session key with our own public key so we can decrypt history
            const encryptedSessionKeyForSelf = await SecureChatCrypto.encryptSessionKey(
                sessionKey, myKeyPair.publicKey
            );

            // Bundle both encrypted session keys
            const sessionKeyBundle = JSON.stringify({
                for_recipient: encryptedSessionKeyForRecipient,
                for_sender: encryptedSessionKeyForSelf
            });

            SecureChatSocket.sendMessage(otherId, encryptedMessage, sessionKeyBundle);

            // Optimistically render the sent message
            await renderMessage({
                id: 'temp-' + Date.now(),
                sender_id: myId,
                receiver_id: otherId,
                encrypted_message: encryptedMessage,
                encrypted_session_key: sessionKeyBundle,
                timestamp: new Date().toISOString(),
                read_at: null
            });
            scrollToBottom();

            // Stop typing indicator
            SecureChatSocket.emitStopTyping(otherId);
        } catch (err) {
            console.error('[Chat] Send error:', err);
            showNotice('Failed to send message. Please try again.');
        } finally {
            sendBtn.disabled = false;
            messageInput.focus();
        }
    });

    // ---------- Typing ----------
    messageInput.addEventListener('input', function () {
        const now = Date.now();
        if (now - lastTypingEmit > 2000) {
            SecureChatSocket.typingDebounce(otherId);
            lastTypingEmit = now;
        }
    });

    // ---------- Socket Handlers ----------
    function setupSocketHandlers() {
        SecureChatSocket.on('message', async function (data) {
            // Only handle messages from the other user in this chat
            if (data.sender_id !== otherId) return;

            try {
                // Parse the session key bundle
                let sessionKeyBundle;
                try {
                    sessionKeyBundle = JSON.parse(data.encrypted_session_key);
                } catch {
                    sessionKeyBundle = { for_recipient: data.encrypted_session_key };
                }

                // Decrypt using our private key (encrypted for us as recipient)
                const sessionKey = await SecureChatCrypto.decryptSessionKey(
                    sessionKeyBundle.for_recipient || data.encrypted_session_key,
                    myKeyPair.privateKey
                );
                await SecureChatCrypto.decryptMessage(
                    data.encrypted_message,
                    sessionKey
                );

                await renderMessage({
                    id: data.message_id,
                    sender_id: data.sender_id,
                    receiver_id: myId,
                    encrypted_message: data.encrypted_message,
                    encrypted_session_key: data.encrypted_session_key,
                    timestamp: data.timestamp,
                    read_at: null
                });
                scrollToBottom();

                // Mark as read
                SecureChatSocket.markRead(data.message_id, data.sender_id);
            } catch (err) {
                console.error('[Chat] Decrypt incoming error:', err);
            }
        });

        SecureChatSocket.on('typing', function (data) {
            if (data.sender_id === otherId) {
                typingIndicator.hidden = false;
            }
        });

        SecureChatSocket.on('stopTyping', function (data) {
            if (data.sender_id === otherId) {
                typingIndicator.hidden = true;
            }
        });

        SecureChatSocket.on('userOnline', function (data) {
            if (data.user_id === otherId) {
                chatStatus.textContent = 'Online';
                chatStatus.classList.add('is-online');
            }
        });

        SecureChatSocket.on('userOffline', function (data) {
            if (data.user_id === otherId) {
                chatStatus.textContent = 'Offline';
                chatStatus.classList.remove('is-online');
            }
        });

        SecureChatSocket.on('readReceipt', function (data) {
            if (data.reader_id === otherId) {
                var bubbles = messagesArea.querySelectorAll('.message-sent');
                bubbles.forEach(function (bubble) {
                    var meta = bubble.querySelector('.message-meta');
                    if (meta && !meta.querySelector('.read-receipt')) {
                        var receipt = document.createElement('span');
                        receipt.className = 'read-receipt';
                        receipt.title = 'Read';
                        receipt.innerHTML = '&#10003;&#10003;';
                        meta.appendChild(receipt);
                    }
                });
            }
        });

        SecureChatSocket.on('connect', function () {
            chatStatus.textContent = 'Connected';
        });

        SecureChatSocket.on('disconnect', function () {
            chatStatus.textContent = 'Reconnecting...';
            chatStatus.classList.remove('is-online');
        });
    }

    // ---------- Helpers ----------
    function scrollToBottom() {
        messagesArea.scrollTop = messagesArea.scrollHeight;
    }

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function showNotice(text) {
        if (loadingMessages) loadingMessages.hidden = true;
        var notice = document.createElement('div');
        notice.className = 'e2ee-notice';
        notice.style.color = '#f85149';
        notice.textContent = text;
        messagesArea.appendChild(notice);
    }

    // Start
    init();
})();
