import logging
from typing import Callable

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlmodel import Session

logger = logging.getLogger(__name__)

# Each entry is (version_str, migration_fn).
# Migrations run in list order. The current version is tracked in the
# AppSetting table under key "schema_version". A fresh install starts at
# version "000" (no entry) and runs all migrations in sequence.
#
# Rules:
# - Use sqlalchemy.inspect(engine) to check column existence before ALTER TABLE.
# - Issue plain ALTER TABLE ... ADD COLUMN (no IF NOT EXISTS) only when absent.
# - Never remove or reorder existing entries.
# - Append new entries for future schema changes.
# - Failures raise — do not swallow exceptions.


def _migrate_001(engine: Engine) -> None:
    """Consolidate image-update tracking columns added ad-hoc before v0.5.0."""
    inspector = inspect(engine)
    existing_cols = {col["name"] for col in inspector.get_columns("container")}

    columns_to_add = [
        ("image_digest", "TEXT"),
        ("registry_digest", "TEXT"),
        ("update_available", "INTEGER NOT NULL DEFAULT 0"),
        ("last_digest_check", "TEXT"),
        ("image_size", "INTEGER"),
        ("update_alert_sent_digest", "TEXT"),
    ]

    with engine.connect() as conn:
        for col_name, col_type in columns_to_add:
            if col_name in existing_cols:
                logger.info("migration 001: column %s already present, skipping", col_name)
                continue
            try:
                conn.execute(text(f"ALTER TABLE container ADD COLUMN {col_name} {col_type}"))
                logger.info("migration 001: added column %s", col_name)
            except Exception as e:
                logger.warning("migration 001: could not add column %s: %s", col_name, e)
                raise
        conn.commit()


def _migrate_002(engine: Engine) -> None:
    """Add last_pulled column to container table (missed from initial image-update schema)."""
    inspector = inspect(engine)
    existing_cols = {col["name"] for col in inspector.get_columns("container")}

    if "last_pulled" in existing_cols:
        logger.info("migration 002: column last_pulled already present, skipping")
        return

    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE container ADD COLUMN last_pulled TEXT"))
            logger.info("migration 002: added column last_pulled")
        except Exception as e:
            logger.warning("migration 002: could not add column last_pulled: %s", e)
            raise
        conn.commit()


def _migrate_003(engine: Engine) -> None:
    """Add net_rx_bytes and net_tx_bytes columns to container table."""
    inspector = inspect(engine)
    existing_cols = {col["name"] for col in inspector.get_columns("container")}

    columns_to_add = [
        ("net_rx_bytes", "INTEGER NOT NULL DEFAULT 0"),
        ("net_tx_bytes", "INTEGER NOT NULL DEFAULT 0"),
    ]

    with engine.connect() as conn:
        for col_name, col_type in columns_to_add:
            if col_name in existing_cols:
                logger.info("migration 003: column %s already present, skipping", col_name)
                continue
            try:
                conn.execute(text(f"ALTER TABLE container ADD COLUMN {col_name} {col_type}"))
                logger.info("migration 003: added column %s", col_name)
            except Exception as e:
                logger.warning("migration 003: could not add column %s: %s", col_name, e)
                raise
        conn.commit()


def _migrate_004(engine: Engine) -> None:
    """Create container_network_history table for per-container network I/O history."""
    inspector = inspect(engine)
    if "container_network_history" in inspector.get_table_names():
        logger.info("migration 004: table container_network_history already present, skipping")
        return

    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE container_network_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                container_id TEXT NOT NULL,
                rx_bytes INTEGER NOT NULL DEFAULT 0,
                tx_bytes INTEGER NOT NULL DEFAULT 0,
                recorded_at TEXT NOT NULL
            )
        """))
        conn.execute(text(
            "CREATE INDEX ix_container_network_history_container_id "
            "ON container_network_history (container_id)"
        ))
        conn.execute(text(
            "CREATE INDEX ix_container_network_history_recorded_at "
            "ON container_network_history (recorded_at)"
        ))
        conn.commit()
    logger.info("migration 004: created table container_network_history")


def _migrate_005(engine: Engine) -> None:
    """Insert default network_history_retention_hours setting if not already present."""
    with engine.connect() as conn:
        conn.execute(text(
            "INSERT OR IGNORE INTO app_setting (key, value, updated_at) "
            "VALUES ('network_history_retention_hours', '6', datetime('now'))"
        ))
        conn.commit()
    logger.info("migration 005: inserted default network_history_retention_hours = 6")


def _migrate_006(engine: Engine) -> None:
    """Rename exited_container_ttl_hours to exited_container_ttl_seconds, converting hours → seconds."""
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT value FROM app_setting WHERE key = 'exited_container_ttl_hours'")
        ).fetchone()

        if row is not None:
            try:
                seconds = round(float(row[0]) * 3600)
            except (ValueError, TypeError):
                seconds = 300
        else:
            seconds = 300

        conn.execute(text(
            "INSERT OR REPLACE INTO app_setting (key, value, updated_at) "
            "VALUES ('exited_container_ttl_seconds', :val, datetime('now'))"
        ), {"val": str(seconds)})

        conn.execute(text(
            "DELETE FROM app_setting WHERE key = 'exited_container_ttl_hours'"
        ))

        conn.commit()
    logger.info(
        "migration 006: renamed exited_container_ttl_hours → exited_container_ttl_seconds (%d seconds)",
        seconds,
    )


def _migrate_007(engine: Engine) -> None:
    """Seed install_id and analytics_enabled AppSetting keys for telemetry."""
    with engine.connect() as conn:
        conn.execute(text(
            "INSERT OR IGNORE INTO app_setting (key, value, updated_at) "
            "VALUES ('install_id', '', datetime('now'))"
        ))
        conn.execute(text(
            "INSERT OR IGNORE INTO app_setting (key, value, updated_at) "
            "VALUES ('analytics_enabled', 'false', datetime('now'))"
        ))
        conn.commit()
    logger.info("migration 007: seeded install_id and analytics_enabled keys")


def _migrate_008(engine: Engine) -> None:
    """Seed analytics_prompt_seen AppSetting key for upgrade-modal tracking."""
    with engine.connect() as conn:
        conn.execute(text(
            "INSERT OR IGNORE INTO app_setting (key, value, updated_at) "
            "VALUES ('analytics_prompt_seen', 'false', datetime('now'))"
        ))
        conn.commit()
    logger.info("migration 008: seeded analytics_prompt_seen key")


MIGRATIONS: list[tuple[str, Callable]] = [
    ("001", _migrate_001),
    ("002", _migrate_002),
    ("003", _migrate_003),
    ("004", _migrate_004),
    ("005", _migrate_005),
    ("006", _migrate_006),
    ("007", _migrate_007),
    ("008", _migrate_008),
]


def run_migrations(engine: Engine, session: Session) -> None:
    """Run any pending migrations in order and update schema_version after each."""
    from services.app_settings import get_setting, set_setting

    current = get_setting(session, "schema_version") or "000"

    for version, fn in MIGRATIONS:
        if version <= current:
            logger.info("migration: %s already applied, skipping", version)
            continue
        logger.info("migration: running %s", version)
        fn(engine)
        set_setting(session, "schema_version", version)
        session.commit()
        logger.info("migration: completed %s", version)
