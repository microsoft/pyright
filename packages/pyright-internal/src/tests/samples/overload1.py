# This sample tests the type checker's handling of the overload decorator.

from typing import overload, Optional
from datetime import datetime, timezone, timedelta


@overload
def from_json_timestamp(ts: int) -> datetime:
    ...


@overload
def from_json_timestamp(ts: None) -> None:
    ...


def from_json_timestamp(ts: Optional[int]) -> Optional[datetime]:
    return (
        None
        if ts is None
        else (datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(milliseconds=ts))
    )


result1: datetime = from_json_timestamp(2418049)

# This should generate an error
result2: datetime = from_json_timestamp(None)

result3: None = from_json_timestamp(None)

# This should generate an error
result4: None = from_json_timestamp(2345)


@overload
def func1(x: int) -> int:
    ...


@overload
def func1(x: float) -> float:
    ...


def func1(x):
    return x


reveal_type(func1(abs(0.0)), expected_text="float")
