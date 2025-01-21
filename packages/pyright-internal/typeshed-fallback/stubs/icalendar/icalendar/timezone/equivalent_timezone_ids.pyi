import datetime
from collections.abc import Callable
from typing import Final

__all__ = ["main"]

def check(dt: datetime.datetime, tz: datetime.tzinfo) -> tuple[datetime.datetime, datetime.timedelta]: ...
def checks(tz: datetime.tzinfo) -> list[tuple[datetime.datetime, datetime.timedelta]]: ...

START: Final[datetime.datetime]
END: Final[datetime.datetime]

DTS: Final[list[datetime.datetime]]

def main(create_timezones: list[Callable[[str], datetime.tzinfo]], name: str, pool_size: int = ...) -> None: ...
