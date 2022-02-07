# This sample tests type narrowing for falsy and truthy values.

from typing import Iterable, List, Literal, Optional, Union


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
        reveal_type(x, expected_text="int | List[int] | A | B | D")
    else:
        reveal_type(x, expected_text="int | List[int] | B | C | None")


def func2(maybe_int: Optional[int]):
    if bool(maybe_int):
        reveal_type(maybe_int, expected_text="int")
    else:
        reveal_type(maybe_int, expected_text="int | None")


def func3(maybe_a: Optional[A]):
    if bool(maybe_a):
        reveal_type(maybe_a, expected_text="A")
    else:
        reveal_type(maybe_a, expected_text="None")


def func4(foo: Iterable[int]) -> None:
    if foo:
        reveal_type(foo, expected_text="Iterable[int]")
    else:
        reveal_type(foo, expected_text="Iterable[int]")
