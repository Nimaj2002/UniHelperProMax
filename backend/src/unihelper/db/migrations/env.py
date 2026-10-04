"""Alembic environment. Uses a connection passed in by unihelper.db.migrate, or the
database derived from UNIHELPER_DATA_DIR when run from the command line."""

from __future__ import annotations

from alembic import context
from sqlalchemy import create_engine

from unihelper.config import load_settings
from unihelper.models import Base

config = context.config
target_metadata = Base.metadata


def run_migrations() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:
        context.configure(
            connection=connection, target_metadata=target_metadata, render_as_batch=True
        )
        with context.begin_transaction():
            context.run_migrations()
        return

    settings = load_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    engine = create_engine(config.get_main_option("sqlalchemy.url") or settings.db_url)
    with engine.connect() as conn:
        context.configure(connection=conn, target_metadata=target_metadata, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()


run_migrations()
