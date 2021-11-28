# This sample tests type narrowing for falsy and truthy values.

from typing import List, Literal, Union


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
