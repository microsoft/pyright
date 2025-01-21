# This sample tests type narrowing for falsey and truthy values.

from typing import (
    AnyStr,
    Iterable,
    Literal,
    NamedTuple,
    NotRequired,
    TypeVar,
    TypedDict,
)
from enum import Enum, IntEnum


class A: ...


class B:
    def __bool__(self) -> bool: ...


class C:
    def __bool__(self) -> Literal[False]: ...


class D:
    def __bool__(self) -> Literal[True]: ...


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


class Enum1(Enum):
    A = 0


class Enum2(Enum):
    A = 0

    def __bool__(self) -> Literal[False]:
        return False


class Enum3(IntEnum):
    A = 0
    B = 1


def func13(x: Literal[Enum1.A]):
    if x:
        reveal_type(x, expected_text="Literal[Enum1.A]")
    else:
        reveal_type(x, expected_text="Never")


def func14(x: Enum1):
    if x:
        reveal_type(x, expected_text="Enum1")
    else:
        reveal_type(x, expected_text="Never")


def func15(x: Literal[Enum2.A]):
    if x:
        reveal_type(x, expected_text="Never")
    else:
        reveal_type(x, expected_text="Literal[Enum2.A]")


def func16(x: Enum2):
    if x:
        reveal_type(x, expected_text="Never")
    else:
        reveal_type(x, expected_text="Enum2")


def func17(x: Enum3):
    if x:
        reveal_type(x, expected_text="Enum3")
    else:
        reveal_type(x, expected_text="Enum3")


def func18(x: Literal[Enum3.A], y: Literal[Enum3.B]):
    if x:
        reveal_type(x, expected_text="Never")
    else:
        reveal_type(x, expected_text="Literal[Enum3.A]")

    if y:
        reveal_type(y, expected_text="Literal[Enum3.B]")
    else:
        reveal_type(y, expected_text="Never")


class TD1(TypedDict):
    d1: int


class TD2(TypedDict):
    d1: NotRequired[int]


class TD3(TypedDict):
    pass


def func19(v1: TD1 | None, v2: TD2 | None, v3: TD3 | None):
    if v1:
        reveal_type(v1, expected_text="TD1")
    else:
        reveal_type(v1, expected_text="None")

    if v2:
        reveal_type(v2, expected_text="TD2")
    else:
        reveal_type(v2, expected_text="TD2 | None")

    if v2 is not None:
        if v2:
            reveal_type(v2, expected_text="TD2")
        else:
            reveal_type(v2, expected_text="TD2")

        v2["d1"] = 1

        if v2:
            reveal_type(v2, expected_text="TD2")
        else:
            reveal_type(v2, expected_text="Never")

    if v3:
        reveal_type(v3, expected_text="TD3")
    else:
        reveal_type(v3, expected_text="TD3 | None")
