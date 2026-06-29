import json
from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlmodel import Session

from models import Operation


TERMINAL_STATUSES = {"succeeded", "failed", "skipped"}


def create_operation(
    session: Session,
    *,
    operation_type: str,
    target_type: str,
    target_id: str,
    target_name: str | None = None,
    phase: str = "queued",
) -> Operation:
    now = datetime.utcnow()
    operation = Operation(
        operation_id=uuid4().hex,
        operation_type=operation_type,
        target_type=target_type,
        target_id=target_id,
        target_name=target_name,
        status="running",
        phase=phase,
        created_at=now,
        updated_at=now,
    )
    session.add(operation)
    session.commit()
    session.refresh(operation)
    return operation


def update_operation(
    session: Session,
    operation: Operation,
    *,
    status: str | None = None,
    phase: str | None = None,
    error: str | None = None,
    result: dict[str, Any] | None = None,
) -> Operation:
    now = datetime.utcnow()
    if status is not None:
        operation.status = status
        if status in TERMINAL_STATUSES:
            operation.completed_at = now
    if phase is not None:
        operation.phase = phase
    if error is not None:
        operation.error = error
    if result is not None:
        operation.result_json = json.dumps(result, sort_keys=True)
    operation.updated_at = now
    session.add(operation)
    session.commit()
    session.refresh(operation)
    return operation


def serialize_operation(operation: Operation) -> dict[str, Any]:
    result: dict[str, Any] | None = None
    if operation.result_json:
        try:
            result = json.loads(operation.result_json)
        except json.JSONDecodeError:
            result = {"raw": operation.result_json}

    return {
        "operation_id": operation.operation_id,
        "operation_type": operation.operation_type,
        "target_type": operation.target_type,
        "target_id": operation.target_id,
        "target_name": operation.target_name,
        "status": operation.status,
        "phase": operation.phase,
        "error": operation.error,
        "result": result,
        "created_at": operation.created_at,
        "updated_at": operation.updated_at,
        "completed_at": operation.completed_at,
    }
