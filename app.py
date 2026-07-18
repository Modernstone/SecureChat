"""
SecureChat Application
======================
Main entry point. Creates the Flask app, initializes SocketIO,
registers blueprints, and configures Flask-Login.
"""

from flask import Flask
from flask_cors import CORS
from flask_login import LoginManager
from flask_socketio import SocketIO
from flask_wtf.csrf import CSRFProtect

from config import Config
from database import get_db, init_db

# Initialize extensions
login_manager = LoginManager()
csrf = CSRFProtect()
socketio = SocketIO()


def create_app():
    """Application factory."""
    app = Flask(__name__)
    app.config.from_object(Config)

    # CORS
    CORS(app, supports_credentials=True)

    # CSRF protection — Flask-WTF reads X-CSRFToken header automatically for AJAX
    csrf.init_app(app)

    # Database
    init_db(app)

    # Flask-Login
    login_manager.init_app(app)
    login_manager.login_view = 'auth.login'
    login_manager.login_message_category = 'info'

    # SocketIO
    socketio.init_app(app, async_mode=app.config.get('SOCKETIO_ASYNC_MODE', 'threading'))

    # Register blueprints
    from auth import auth_bp
    from routes import main_bp
    app.register_blueprint(auth_bp)
    app.register_blueprint(main_bp)

    # Register SocketIO events
    from websocket import register_socket_events
    register_socket_events(socketio)

    return app


# Flask-Login user loader
@login_manager.user_loader
def load_user(user_id):
    from models import User
    return get_db().query(User).get(int(user_id))


# Create the app instance
app = create_app()


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
