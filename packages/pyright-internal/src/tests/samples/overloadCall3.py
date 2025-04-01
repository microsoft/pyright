# This sample tests the case where an implementation of an overload uses
# a decorator that turns it into a non-function type.

from functools import lru_cache
from typing import AnyStr, overload


@overload
def func1(url: str) -> str: ...


@overload
def func1(url: bytes) -> bytes: ...


@lru_cache()
def func1(url: AnyStr) -> str | bytes: ...


reveal_type(func1(""), expected_text="str")
reveal_type(func1(b""), expected_text="bytes")
