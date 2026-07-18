"""
SecureChat Routes
=================
Dashboard, chat page, profile page, and JSON API endpoints.
"""

from datetime import datetime, timezone

from flask import Blueprint, jsonify, redirect, render_template, request, url_for
from flask_login import current_user, login_required

from database import get_db
from models import Message, User

main_bp = Blueprint('main', __name__)


@main_bp.route('/')
def index():
    """Redirect to dashboard if authenticated, otherwise to login."""
    if current_user.is_authenticated:
        return redirect(url_for('main.dashboard'))
    return redirect(url_for('auth.login'))


@main_bp.route('/dashboard')
@login_required
def dashboard():
    """Show the user list with online status."""
    return render_template('dashboard.html')


@main_bp.route('/chat/<int:user_id>')
@login_required
def chat(user_id):
    """Chat page for a specific user."""
    db = get_db()
    other_user = db.query(User).get(user_id)
    if not other_user or other_user.id == current_user.id:
        return redirect(url_for('main.dashboard'))
    return render_template('chat.html', other_user=other_user)


@main_bp.route('/profile')
@login_required
def profile():
    """User profile page."""
    return render_template('profile.html')


# ---- JSON API Endpoints ----

@main_bp.route('/api/users')
@login_required
def api_users():
    """Return list of all users except current, with online status."""
    from websocket import online_users
    db = get_db()
    users = db.query(User).filter(User.id != current_user.id).order_by(User.username).all()

    result = []
    for u in users:
        last_seen = u.last_seen
        if last_seen:
            last_seen_str = _time_ago(last_seen)
        else:
            last_seen_str = 'Never'
        result.append({
            'id': u.id,
            'username': u.username,
            'online': u.id in online_users,
            'last_seen': last_seen_str
        })

    return jsonify(users=result)


@main_bp.route('/api/messages/<int:user_id>')
@login_required
def api_messages(user_id):
    """Return encrypted message history between current_user and user_id."""
    db = get_db()
    messages = (
        db.query(Message)
        .filter(
            ((Message.sender_id == current_user.id) & (Message.receiver_id == user_id)) |
            ((Message.sender_id == user_id) & (Message.receiver_id == current_user.id))
        )
        .order_by(Message.timestamp.asc())
        .all()
    )

    result = []
    for m in messages:
        result.append({
            'id': m.id,
            'sender_id': m.sender_id,
            'receiver_id': m.receiver_id,
            'encrypted_message': m.encrypted_message,
            'encrypted_session_key': m.encrypted_session_key,
            'timestamp': m.timestamp.isoformat() + 'Z',
            'read_at': m.read_at.isoformat() + 'Z' if m.read_at else None
        })

    return jsonify(messages=result)


@main_bp.route('/api/public_key/<int:user_id>')
@login_required
def api_public_key(user_id):
    """Return a user's public key."""
    db = get_db()
    user = db.query(User).get(user_id)
    if not user:
        return jsonify(error='User not found'), 404
    return jsonify(user_id=user.id, public_key=user.public_key)


@main_bp.route('/api/update_public_key', methods=['POST'])
@login_required
def api_update_public_key():
    """Update the current user's public key (e.g., after re-generating keys in a new browser)."""
    data = request.get_json(silent=True) or {}
    public_key = data.get('public_key')
    if not public_key:
        return jsonify(success=False, message='Public key is required.'), 400

    db = get_db()
    current_user.public_key = public_key
    db.commit()

    return jsonify(success=True)


def _time_ago(dt):
    """Convert a datetime to a human-readable 'X minutes ago' string."""
    now = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta = now - dt
    seconds = int(delta.total_seconds())

    if seconds < 60:
        return 'just now'
    elif seconds < 3600:
        mins = seconds // 60
        return f'{mins} minute{"s" if mins != 1 else ""} ago'
    elif seconds < 86400:
        hours = seconds // 3600
        return f'{hours} hour{"s" if hours != 1 else ""} ago'
    else:
        days = seconds // 86400
        return f'{days} day{"s" if days != 1 else ""} ago'
