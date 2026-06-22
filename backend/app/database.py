from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import get_settings


settings = get_settings()
database_url = settings.database_sync_url
if database_url.startswith("sqlite"):
    Path("data").mkdir(exist_ok=True)

engine_options = {}
if database_url.startswith("sqlite"):
    engine_options["connect_args"] = {"check_same_thread": False}
if database_url in {"sqlite://", "sqlite:///:memory:"}:
    engine_options["poolclass"] = StaticPool

engine = create_engine(database_url, **engine_options)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
