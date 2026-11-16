# This sample tests the type checker's handling of the overload decorator.

from typing import overload
from datetime import datetime, timezone, timedelta


@overload
def func1(ts: int) -> datetime: ...


@overload
def func1(ts: None) -> None: ...


@overload
def func1(ts: complex): ...


def func1(ts: int | complex | None) -> datetime | None:
    return (
        None
        if not isinstance(ts, int)
        else (datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(milliseconds=ts))
    )


reveal_type(func1(2418049), expected_text="datetime")
reveal_type(func1(None), expected_text="None")
reveal_type(func1(3j), expected_text="Unknown")


@overload
def func2(x: int) -> int: ...


@overload
def func2(x: float) -> float: ...


def func2(x):
    return x


reveal_type(func2(abs(0.0)), expected_text="float")
