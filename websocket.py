"""
SecureChat WebSocket Events
============================
Handles SocketIO events: connect/disconnect, send_message, typing,
stop_typing, mark_read. The server only relays encrypted data.
"""

from datetime import datetime, timezone

from flask import request as flask_request
from flask_login import current_user
from flask_socketio import emit, join_room, leave_room

from database import get_db
from models import Message, User

# Track online users: { user_id: sid }
online_users = {}


def register_socket_events(socketio):
    """Register all SocketIO event handlers."""

    @socketio.on('user_connected')
    def handle_user_connected(data):
        """Client announces themselves after connecting."""
        user_id = data.get('user_id')
        if not user_id:
            return
        user_id = int(user_id)
        sid = flask_request.sid
        online_users[user_id] = sid

        # Update last_seen
        db = get_db()
        user = db.query(User).get(user_id)
        if user:
            user.last_seen = datetime.now(timezone.utc)
            db.commit()

        # Join a personal room for targeted messages
        join_room(f'user_{user_id}')

        # Broadcast online status
        emit('user_online', {'user_id': user_id}, broadcast=True, include_self=False)

    @socketio.on('disconnect')
    def handle_disconnect():
        """Clean up when a client disconnects."""
        sid = flask_request.sid
        # Find which user had this sid
        disconnected_user_id = None
        for uid, s in list(online_users.items()):
            if s == sid:
                disconnected_user_id = uid
                break

        if disconnected_user_id is not None:
            del online_users[disconnected_user_id]
            leave_room(f'user_{disconnected_user_id}')

            # Update last_seen
            db = get_db()
            user = db.query(User).get(disconnected_user_id)
            if user:
                user.last_seen = datetime.now(timezone.utc)
                db.commit()

            emit('user_offline', {'user_id': disconnected_user_id}, broadcast=True)

    @socketio.on('send_message')
    def handle_send_message(data):
        """
        Receive an encrypted message from sender, store it, and forward
        to the recipient's room. Server never sees plaintext.
        """
        sender_id = _get_current_user_id()
        if not sender_id:
            return

        receiver_id = data.get('receiver_id')
        encrypted_message = data.get('encrypted_message')
        encrypted_session_key = data.get('encrypted_session_key')

        if not all([receiver_id, encrypted_message, encrypted_session_key]):
            return

        receiver_id = int(receiver_id)

        # Store the encrypted message in the database
        db = get_db()
        msg = Message(
            sender_id=sender_id,
            receiver_id=receiver_id,
            encrypted_message=encrypted_message,
            encrypted_session_key=encrypted_session_key
        )
        db.add(msg)
        db.commit()

        # Forward to recipient's room
        emit('new_message', {
            'message_id': msg.id,
            'sender_id': sender_id,
            'encrypted_message': encrypted_message,
            'encrypted_session_key': encrypted_session_key,
            'timestamp': msg.timestamp.isoformat() + 'Z'
        }, room=f'user_{receiver_id}')

    @socketio.on('typing')
    def handle_typing(data):
        """Forward typing indicator to the recipient."""
        sender_id = _get_current_user_id()
        receiver_id = data.get('receiver_id')
        if not sender_id or not receiver_id:
            return
        emit('user_typing', {'sender_id': sender_id}, room=f'user_{int(receiver_id)}')

    @socketio.on('stop_typing')
    def handle_stop_typing(data):
        """Forward stop-typing indicator to the recipient."""
        sender_id = _get_current_user_id()
        receiver_id = data.get('receiver_id')
        if not sender_id or not receiver_id:
            return
        emit('user_stop_typing', {'sender_id': sender_id}, room=f'user_{int(receiver_id)}')

    @socketio.on('mark_read')
    def handle_mark_read(data):
        """Mark a message as read and notify the sender."""
        reader_id = _get_current_user_id()
        message_id = data.get('message_id')
        sender_id = data.get('sender_id')

        if not reader_id or not message_id:
            return

        db = get_db()
        msg = db.query(Message).get(int(message_id))
        if msg and msg.receiver_id == reader_id:
            msg.read_at = datetime.now(timezone.utc)
            db.commit()

            # Notify the original sender
            emit('message_read', {
                'message_id': msg.id,
                'reader_id': reader_id,
                'read_at': msg.read_at.isoformat() + 'Z'
            }, room=f'user_{int(sender_id)}')


def _get_current_user_id():
    """Get the current user ID from the online_users map by sid."""
    sid = flask_request.sid
    for uid, s in online_users.items():
        if s == sid:
            return uid
    return None
