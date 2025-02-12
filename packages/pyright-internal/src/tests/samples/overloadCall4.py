# This sample tests the expansion of argument types during overload matching.


from enum import Enum
from typing import AnyStr, Literal, TypeVar, overload


class A: ...


class B: ...


class C: ...


_T1 = TypeVar("_T1", bound=B)


@overload
def overloaded1(x: A) -> str: ...


@overload
def overloaded1(x: _T1) -> _T1: ...


def overloaded1(x: A | B) -> str | B: ...


def func1(a: A | B, b: A | B | C):
    v1 = overloaded1(a)
    reveal_type(v1, expected_text="str | B")

    # This should generate an error because C is not allowed
    # for the first argument.
    v2 = overloaded1(b)


class LargeEnum(Enum):
    x00 = 0
    x01 = 0
    x02 = 0
    x03 = 0
    x04 = 0
    x05 = 0
    x06 = 0
    x07 = 0
    x08 = 0
    x09 = 0
    x10 = 0
    x11 = 0
    x12 = 0
    x13 = 0
    x14 = 0
    x15 = 0
    x16 = 0
    x17 = 0
    x18 = 0
    x19 = 0
    x20 = 0
    x21 = 0
    x22 = 0
    x23 = 0
    x24 = 0
    x25 = 0
    x26 = 0
    x27 = 0
    x28 = 0
    x29 = 0
    x30 = 0
    x31 = 0
    x32 = 0
    x33 = 0
    x34 = 0
    x35 = 0
    x36 = 0
    x37 = 0
    x38 = 0
    x39 = 0
    x40 = 0
    x41 = 0
    x42 = 0
    x43 = 0
    x44 = 0
    x45 = 0
    x46 = 0
    x47 = 0
    x48 = 0
    x49 = 0
    x50 = 0
    x51 = 0
    x52 = 0
    x53 = 0
    x54 = 0
    x55 = 0
    x56 = 0
    x57 = 0
    x58 = 0
    x59 = 0
    x60 = 0
    x61 = 0
    x62 = 0
    x63 = 0
    x64 = 0
    x65 = 0
    x66 = 0
    x67 = 0
    x68 = 0
    x69 = 0


LargeUnion = (
    Literal[
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "g",
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
    ]
    | LargeEnum
)


@overload
def overloaded2(a: LargeUnion, b: Literal[2]) -> str: ...


@overload
def overloaded2(a: LargeUnion, b: Literal[3]) -> str: ...


@overload
def overloaded2(a: LargeUnion, b: Literal[4]) -> float: ...


@overload
def overloaded2(a: LargeUnion, b: Literal[9]) -> float: ...


@overload
def overloaded2(a: LargeUnion, b: Literal[10]) -> float: ...


def overloaded2(a: LargeUnion, b: LargeUnion | Literal[9, 10]) -> str | float: ...


def func2(a: LargeUnion, b: Literal[2, 3, 4], c: Literal[2, 3, 4, 9, 10] | LargeEnum):
    v1 = overloaded2("a", 2)
    reveal_type(v1, expected_text="str")

    v2 = overloaded2(a, b)
    reveal_type(v2, expected_text="str | float")

    # This should generate an error because the expansion of union types
    # will exceed the max number of expansions (256).
    v3 = overloaded2(a, c)
    reveal_type(v2, expected_text="str | float")


_T2 = TypeVar("_T2", str, bytes)


@overload
def overloaded3(x: str) -> str: ...


@overload
def overloaded3(x: bytes) -> bytes: ...


def overloaded3(x: str | bytes) -> str | bytes: ...


def func3(y: _T2):
    overloaded3(y)


_T3 = TypeVar("_T3")


def func5(a: _T3) -> _T3:
    return a


@overload
def overloaded4(b: str) -> str: ...


@overload
def overloaded4(b: int) -> int: ...


def overloaded4(b: str | int) -> str | int: ...


def func6(x: str | int) -> None:
    y: str | int = overloaded4(func5(x))


@overload
def overloaded5(pattern: AnyStr) -> AnyStr: ...


@overload
def overloaded5(pattern: int) -> int: ...


def overloaded5(pattern: AnyStr | int) -> AnyStr | int:
    return 0


def func7(a: str | bytes) -> str | bytes:
    return overloaded5(a)


def func8(a: AnyStr | str | bytes) -> str | bytes:
    return overloaded5(a)


class E(Enum):
    A = "A"
    B = "B"


@overload
def func9(v: Literal[E.A]) -> int: ...
@overload
def func9(v: Literal[E.B]) -> str: ...
@overload
def func9(v: bool) -> list[str]: ...


def func9(v: E | bool) -> int | str | list[str]: ...


def test9(a1: E | bool):
    reveal_type(func9(a1), expected_text="int | str | list[str]")


@overload
def func10(v: Literal[True]) -> int: ...
@overload
def func10(v: Literal[False]) -> str: ...


def func10(v: bool) -> int | str: ...


def test10(a1: bool):
    reveal_type(func10(a1), expected_text="int | str")


@overload
def func11(v: tuple[int, int]) -> int: ...


@overload
def func11(v: tuple[str, int]) -> str: ...


@overload
def func11(v: tuple[int, str]) -> int: ...


@overload
def func11(v: tuple[str, str]) -> str: ...


def func11(v: tuple[int | str, int | str]) -> int | str: ...


def test11(a1: tuple[int | str, int | str]):
    reveal_type(func11(a1), expected_text="int | str")
