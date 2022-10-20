# This sample tests type narrowing for falsy and truthy values.

from typing import Iterable, List, Literal, NamedTuple, Optional, Union


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


def func5(foo: tuple[int]) -> None:
    if foo:
        reveal_type(foo, expected_text="tuple[int]")
    else:
        reveal_type(foo, expected_text="Never")


def func6(foo: tuple[int, ...]) -> None:
    if foo:
        reveal_type(foo, expected_text="tuple[int, ...]")
    else:
        reveal_type(foo, expected_text="tuple[int, ...]")


def func7(foo: tuple[()]) -> None:
    if foo:
        reveal_type(foo, expected_text="Never")
    else:
        reveal_type(foo, expected_text="tuple[()]")


class NT1(NamedTuple):
    foo: int


def func8(foo: NT1) -> None:
    if foo:
        reveal_type(foo, expected_text="NT1")
    else:
        reveal_type(foo, expected_text="Never")

class NT2(NT1):
    pass

def func9(foo: NT2) -> None:
    if foo:
        reveal_type(foo, expected_text="NT2")
    else:
        reveal_type(foo, expected_text="Never")
