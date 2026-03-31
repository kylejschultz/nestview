from datetime import datetime
from typing import Optional

from sqlmodel import Session, select

from models import AppSetting


def get_setting(session: Session, key: str) -> Optional[str]:
    row = session.exec(select(AppSetting).where(AppSetting.key == key)).first()
    return row.value if row is not None else None


def set_setting(session: Session, key: str, value: str) -> None:
    row = session.exec(select(AppSetting).where(AppSetting.key == key)).first()
    if row is None:
        row = AppSetting(key=key, value=value, updated_at=datetime.utcnow())
    else:
        row.value = value
        row.updated_at = datetime.utcnow()
    session.add(row)
