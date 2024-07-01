# This sample tests the case where a source and dest type
# are unions and are being compared using invariant constraints
# and the dest type contains a type variable.

from typing import Pattern, Sequence, TypeVar


_T = TypeVar("_T")


def func1(v: list[_T | None]) -> _T: ...


def func2(v: list[_T | str | None]) -> _T: ...


v1: list[int | None] = [1, None]
r1 = func1(v1)
reveal_type(r1, expected_text="int")

v2: list[int | str | None] = [1, None]
r2_1 = func1(v2)
reveal_type(r2_1, expected_text="int | str")

r2_2 = func2(v2)
reveal_type(r2_2, expected_text="int")

v3: list[str | Sequence[Pattern]] = [""]
