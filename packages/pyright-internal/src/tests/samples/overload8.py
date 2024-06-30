# This sample tests the expansion of union types during overload matching.


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


LargeUnion = Literal["a", "b", "c", "d", "e", "f", "g", 1, 2, 3, 4, 5, 6, 7, 8]


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


def func2(a: LargeUnion, b: Literal[2, 3, 4], c: Literal[2, 3, 4, 9, 10]):
    v1 = overloaded2("a", 2)
    reveal_type(v1, expected_text="str")

    v2 = overloaded2(a, b)
    reveal_type(v2, expected_text="str | float")

    # This should generate an error because the expansion of union types
    # will exceed the max number of expansions (64).
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
