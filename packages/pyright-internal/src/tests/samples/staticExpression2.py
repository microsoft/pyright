# This sample tests a special form of a sys.version_info check.

import sys
from datetime import datetime, timezone, timedelta
from typing import overload, Optional

# Overload was broken before 3.5.2.
# This sort of hack is seen in some type-annotated code to prevent crashes.
if sys.version_info < (3, 5, 2):

    def overload(f):
        return f


@overload
def from_json_timestamp(ts: int) -> datetime: ...


@overload
def from_json_timestamp(ts: None) -> None: ...


def from_json_timestamp(ts: Optional[int]) -> Optional[datetime]:
    return (
        None
        if ts is None
        else (datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(milliseconds=ts))
    )


result1: datetime = from_json_timestamp(2418049)
result3: None = from_json_timestamp(None)
