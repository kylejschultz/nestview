from sqlalchemy import inspect
from sqlmodel import Session, SQLModel, create_engine, select

from migrations import run_migrations
from models import AppSetting, ContainerAlertSetting


def test_run_migrations_advances_schema_version_and_is_idempotent():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        run_migrations(engine, session)
        run_migrations(engine, session)

        schema_version = session.get(AppSetting, "schema_version")
        analytics_last_ping = session.get(AppSetting, "analytics_last_ping_date")
        retention = session.get(AppSetting, "network_history_retention_hours")
        global_alert_rows = session.exec(
            select(ContainerAlertSetting).where(
                ContainerAlertSetting.container_name == "__global__"
            )
        ).all()

    assert schema_version is not None
    assert schema_version.value == "015"
    assert analytics_last_ping is not None
    assert analytics_last_ping.value == ""
    assert retention is not None
    assert retention.value == "6"
    assert {row.event_type for row in global_alert_rows} == {
        "crash",
        "restart",
        "oom",
        "update_available",
    }
    assert "operation" in inspect(engine).get_table_names()
    assert "notification_destination" in inspect(engine).get_table_names()
    assert "ix_operation_running_target" in {
        index["name"] for index in inspect(engine).get_indexes("operation")
    }
