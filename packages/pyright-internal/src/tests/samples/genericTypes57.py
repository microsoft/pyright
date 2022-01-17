# This sample tests the case where a source and dest type
# are unions and are being compared using invariant constraints
# and the dest type contains a type variable.

from typing import Pattern, Sequence, TypeVar, List, Optional, Union


_T = TypeVar("_T")


def func1(v: List[Optional[_T]]) -> _T:
    ...


def func2(v: List[Optional[Union[_T, str]]]) -> _T:
    ...


v1: List[Optional[int]] = [1, None]
r1 = func1(v1)
reveal_type(r1, expected_text="int")

v2: List[Optional[Union[int, str]]] = [1, None]
r2_1 = func1(v2)
reveal_type(r2_1, expected_text="int | str")

r2_2 = func2(v2)
reveal_type(r2_2, expected_text="int")

v3: List[Union[str, Sequence[Pattern]]] = [""]
