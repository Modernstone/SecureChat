from datetime import datetime, timezone

from flask_login import UserMixin
from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from database import Base


class User(UserMixin, Base):
    """User model — stores only password hashes and public keys."""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    email = Column(String(120), unique=True, nullable=False, index=True)
    password_hash = Column(String(128), nullable=False)
    public_key = Column(Text, nullable=False)
    created_at = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )
    last_seen = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )

    # Sent / received message relationships
    sent_messages = relationship("Message", foreign_keys="Message.sender_id", backref="sender", lazy="dynamic")
    received_messages = relationship("Message", foreign_keys="Message.receiver_id", backref="receiver", lazy="dynamic")

    def __repr__(self):
        return f"<User {self.username}>"


class Message(Base):
    """Encrypted message — server never stores plaintext."""

    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    receiver_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    encrypted_message = Column(Text, nullable=False)
    encrypted_session_key = Column(Text, nullable=False)
    timestamp = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )
    read_at = Column(DateTime, nullable=True)

    def __repr__(self):
        return f"<Message {self.id} from {self.sender_id} to {self.receiver_id}>"
