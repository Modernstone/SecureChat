from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, scoped_session, sessionmaker

# Declarative base for models
Base = declarative_base()

# Engine and session factory — configured later by init_db()
_engine = None
_session_factory = None
db_session = None


def init_db(app):
    """Initialize the database engine, create tables, and configure the scoped session."""
    global _engine, _session_factory, db_session

    _engine = create_engine(app.config["SQLALCHEMY_DATABASE_URI"], echo=False)
    _session_factory = sessionmaker(bind=_engine)
    db_session = scoped_session(_session_factory)

    # Import models so they register with Base before create_all
    import models  # noqa: F401

    Base.metadata.create_all(_engine)

    # Teardown: remove session at end of each request
    @app.teardown_appcontext
    def shutdown_session(exception=None):
        if db_session is not None:
            db_session.remove()


def get_db():
    """Return the current scoped database session."""
    return db_session
