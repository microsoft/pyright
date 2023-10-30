# This sample tests type narrowing for falsey and truthy values.

from typing import AnyStr, Iterable, Literal, NamedTuple, TypeVar, Union, final


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


def func1(x: int | list[int] | A | B | C | D | None) -> None:
    if x:
        reveal_type(x, expected_text="int | list[int] | A | B | D")
    else:
        reveal_type(x, expected_text="list[int] | B | C | Literal[0] | None")


def func2(maybe_int: int | None):
    if bool(maybe_int):
        reveal_type(maybe_int, expected_text="int")
    else:
        reveal_type(maybe_int, expected_text="Literal[0] | None")


def func3_1(maybe_a: A | None):
    if bool(maybe_a):
        reveal_type(maybe_a, expected_text="A")
    else:
        reveal_type(maybe_a, expected_text="None")


def func3_2(maybe_a: A | None):
    if bool(maybe_a):
        reveal_type(maybe_a, expected_text="A")
    else:
        reveal_type(maybe_a, expected_text="None")


def func4(val: Iterable[int]) -> None:
    if val:
        reveal_type(val, expected_text="Iterable[int]")
    else:
        reveal_type(val, expected_text="Iterable[int]")


def func5(val: tuple[int]) -> None:
    if val:
        reveal_type(val, expected_text="tuple[int]")
    else:
        reveal_type(val, expected_text="Never")


def func6(val: tuple[int, ...]) -> None:
    if val:
        reveal_type(val, expected_text="tuple[int, ...]")
    else:
        reveal_type(val, expected_text="tuple[int, ...]")


def func7(val: tuple[()]) -> None:
    if val:
        reveal_type(val, expected_text="Never")
    else:
        reveal_type(val, expected_text="tuple[()]")


class NT1(NamedTuple):
    val: int


def func8(val: NT1) -> None:
    if val:
        reveal_type(val, expected_text="NT1")
    else:
        reveal_type(val, expected_text="Never")


class NT2(NT1):
    pass


def func9(val: NT2) -> None:
    if val:
        reveal_type(val, expected_text="NT2")
    else:
        reveal_type(val, expected_text="Never")


class E:
    def __init__(self, value: int = 0) -> None:
        self.value = value

    def __bool__(self) -> bool:
        return self.value >= 0

    def method(self) -> None:
        while not self:
            reveal_type(self, expected_text="Self@E")
            self.value += 1


def func10(val: AnyStr | None):
    return 1


def func11(val: AnyStr | None):
    assert val
    reveal_type(val, expected_text="AnyStr@func11")


T = TypeVar("T")


def func12(val: T) -> T:
    if val:
        reveal_type(val, expected_text="T@func12")
    else:
        reveal_type(val, expected_text="T@func12")

    return val
