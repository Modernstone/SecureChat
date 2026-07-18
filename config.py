import os
import secrets


class Config:
    """Flask application configuration."""

    # Secret key for sessions and CSRF tokens
    SECRET_KEY = os.environ.get("SECRET_KEY") or secrets.token_hex(32)

    # SQLite database
    BASEDIR = os.path.abspath(os.path.dirname(__file__))
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL"
    ) or "sqlite:///" + os.path.join(BASEDIR, "securechat.db")
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Session security
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    PERMANENT_SESSION_LIFETIME = 3600  # 1 hour

    # Rate limiting
    MAX_LOGIN_ATTEMPTS = 5
    LOGIN_LOCKOUT_SECONDS = 300  # 5 minutes

    # SocketIO settings
    SOCKETIO_ASYNC_MODE = "threading"

    # Application settings
    MAX_MESSAGE_LENGTH = 10000
    MAX_USERNAME_LENGTH = 64
    MAX_EMAIL_LENGTH = 120
