# This sample tests the case where a source and dest type
# are unions and are being compared using invariant constraints
# and the dest type contains a type variable.

from typing import Literal, Pattern, Sequence, TypeVar, List, Optional, Union


_T = TypeVar("_T")


def func1(v: List[Optional[_T]]) -> _T:
    ...


def func2(v: List[Optional[Union[_T, str]]]) -> _T:
    ...


v1: List[Optional[int]] = [1, None]
r1 = func1(v1)
t_r1: Literal["int"] = reveal_type(r1)

v2: List[Optional[Union[int, str]]] = [1, None]
r2_1 = func1(v2)
t_r2_1: Literal["int | str"] = reveal_type(r2_1)

r2_2 = func2(v2)
t_r2_2: Literal["int"] = reveal_type(r2_2)

v3: List[Union[str, Sequence[Pattern]]] = [""]
