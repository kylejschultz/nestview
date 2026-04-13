import logging
from typing import Callable

from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

# Each entry is (version_str, migration_fn).
# Migrations run in list order. The current version is tracked in the
# AppSetting table under key "schema_version". A fresh install starts at
# version "000" (no entry) and runs all migrations in sequence.
#
# Rules:
# - Use ALTER TABLE ... ADD COLUMN IF NOT EXISTS for safety.
# - Never remove or reorder existing entries.
# - Append new entries for future schema changes.
# - Failures raise — do not swallow exceptions.

def _migrate_001(conn) -> None:
    """Consolidate image-update tracking columns added ad-hoc before v0.5.0."""
    stmts = [
        "ALTER TABLE container ADD COLUMN IF NOT EXISTS image_digest TEXT",
        "ALTER TABLE container ADD COLUMN IF NOT EXISTS registry_digest TEXT",
        "ALTER TABLE container ADD COLUMN IF NOT EXISTS update_available INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE container ADD COLUMN IF NOT EXISTS last_digest_check TEXT",
        "ALTER TABLE container ADD COLUMN IF NOT EXISTS image_size INTEGER",
        "ALTER TABLE container ADD COLUMN IF NOT EXISTS update_alert_sent_digest TEXT",
    ]
    for stmt in stmts:
        conn.execute(stmt)
    conn.commit()


MIGRATIONS: list[tuple[str, Callable]] = [
    ("001", _migrate_001),
]


def run_migrations(engine: Engine) -> None:
    """Run any pending migrations in order and update schema_version after each."""
    from sqlmodel import Session, select
    from models import AppSetting

    with Session(engine) as session:
        row = session.exec(select(AppSetting).where(AppSetting.key == "schema_version")).first()
        current = row.value if row is not None else "000"

    conn = engine.raw_connection()
    try:
        for version, fn in MIGRATIONS:
            if version <= current:
                continue
            logger.info("migration: running %s", version)
            fn(conn)
            # Update version in DB after each successful migration
            with Session(engine) as session:
                row = session.exec(select(AppSetting).where(AppSetting.key == "schema_version")).first()
                if row is None:
                    from datetime import datetime
                    row = AppSetting(key="schema_version", value=version, updated_at=datetime.utcnow())
                else:
                    from datetime import datetime
                    row.value = version
                    row.updated_at = datetime.utcnow()
                session.add(row)
                session.commit()
            logger.info("migration: completed %s", version)
    finally:
        conn.close()
