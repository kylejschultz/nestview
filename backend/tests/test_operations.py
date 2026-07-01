from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel, create_engine

from api.operations import get_operation
from models import Operation
from services.operations import create_operation, update_operation


def test_get_operation_returns_serialized_status():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        operation = Operation(
            operation_id="op-123",
            operation_type="update-and-restart",
            target_type="container",
            target_id="docker-1",
            target_name="app",
            status="succeeded",
            phase="complete",
            result_json='{"restarted": true}',
        )
        session.add(operation)
        session.commit()

        result = get_operation("op-123", session=session)

    assert result["operation_id"] == "op-123"
    assert result["status"] == "succeeded"
    assert result["phase"] == "complete"
    assert result["result"] == {"restarted": True}


def test_get_operation_returns_404_for_missing_operation():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        try:
            get_operation("missing", session=session)
        except HTTPException as exc:
            assert exc.status_code == 404
        else:
            raise AssertionError("expected HTTPException")


def test_running_operation_uniqueness_allows_retry_after_terminal_status():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        first = create_operation(
            session,
            operation_type="update-and-restart",
            target_type="container",
            target_id="docker-1",
            target_name="app",
        )
        first_operation_id = first.operation_id

        try:
            create_operation(
                session,
                operation_type="update-and-restart",
                target_type="container",
                target_id="docker-1",
                target_name="app",
            )
        except IntegrityError:
            session.rollback()
        else:
            raise AssertionError("expected IntegrityError")

        update_operation(session, first, status="failed", phase="pull-failed")
        second = create_operation(
            session,
            operation_type="update-and-restart",
            target_type="container",
            target_id="docker-1",
            target_name="app",
        )
        second_operation_id = second.operation_id

    assert second_operation_id != first_operation_id
