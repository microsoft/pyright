# This sample tests the case where a Callable uses an unpacked TypeVarTuple
# followed by another positional parameter.

from typing import TypeVarTuple, TypeVar, Generic, Callable

T = TypeVar("T")
Ts = TypeVarTuple("Ts")


class A(Generic[*Ts, T]): ...


def deco1(x: Callable[[*tuple[*Ts, int]], None]) -> tuple[*Ts]: ...


def deco2(x: Callable[[*tuple[*Ts, str]], None]) -> tuple[*Ts]: ...


def deco3(x: Callable[[*tuple[str, int]], None]) -> None: ...


def deco4(x: Callable[[*Ts, T], None]) -> A[*Ts, T]:
    return A()


def func1(a: str, b: int) -> None: ...


def func2(a: str, b: str, c: int) -> None: ...


v1 = deco1(func1)
reveal_type(v1, expected_text="tuple[str]")

v2 = deco1(func2)
reveal_type(v2, expected_text="tuple[str, str]")

# This should generate an error.
deco2(func1)

deco3(func1)

v3 = deco4(func1)
reveal_type(v3, expected_text="A[str, int]")

v4 = deco4(func2)
reveal_type(v4, expected_text="A[str, str, int]")
