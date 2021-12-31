# This sample tests type narrowing for falsy and truthy values.

from typing import List, Literal, Optional, Union


class A:
    ...


class B:
    def __bool__(self) -> bool:
        ...


class C:
    def __bool__(self) -> Literal[False]:
        ...


class D:
    def __bool__(self) -> Literal[True]:
        ...


def func1(x: Union[int, List[int], A, B, C, D, None]) -> None:
    if x:
        t1: Literal["int | List[int] | A | B | D"] = reveal_type(x)
    else:
        t2: Literal["int | List[int] | B | C | None"] = reveal_type(x)


def func2(maybe_int: Optional[int]):
    if bool(maybe_int):
        t1: Literal["int"] = reveal_type(maybe_int)
    else:
        t2: Literal["int | None"] = reveal_type(maybe_int)


def func3(maybe_a: Optional[A]):
    if bool(maybe_a):
        t1: Literal["A"] = reveal_type(maybe_a)
    else:
        t2: Literal["None"] = reveal_type(maybe_a)
