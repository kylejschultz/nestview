from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from database import get_session
from models import Operation
from services.operations import serialize_operation

router = APIRouter(prefix="/api/operations", tags=["operations"])


@router.get("/{operation_id}")
def get_operation(operation_id: str, session: Session = Depends(get_session)):
    operation = session.exec(
        select(Operation).where(Operation.operation_id == operation_id)
    ).first()
    if operation is None:
        raise HTTPException(status_code=404, detail="Operation not found")
    return serialize_operation(operation)
