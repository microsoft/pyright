# This sample tests removing None from the LHS of a positive identity
# comparison when the RHS is statically known not to contain None.

# pyright: strict

from enum import IntEnum
from typing import Any, Callable, Generic, Protocol, TypeVar, reveal_type
from typing_extensions import NewType


class A:
    def method(self) -> int:
        return 1


T = TypeVar("T")


def f1(x: A | None, y: A):
    if x is y:
        reveal_type(x, expected_text="A")

    if x is not y:
        reveal_type(x, expected_text="A | None")


def f2(x: A | None, y: A | None):
    if x is y:
        reveal_type(x, expected_text="A | None")


def f3(x: A | None, y: Any):
    if x is y:
        reveal_type(x, expected_text="A | None")


def f4(x: A | None, y: object):
    if x is y:
        reveal_type(x, expected_text="A | None")


def f5(x: A | None, y: object):
    if x is not y:
        reveal_type(x, expected_text="A | None")


def f6(x: A | None, y: A | int):
    if x is y:
        reveal_type(x, expected_text="A")


def f7(x: A | None, y: int):
    u = x.unknown_method()  # type: ignore
    reveal_type(u, expected_text="Unknown")
    if x is u:
        reveal_type(x, expected_text="A | None")


def f8(x: T | None, y: T):
    if x is y:
        reveal_type(x, expected_text="T@f8 | None")


TB = TypeVar("TB", bound=A)
TBO = TypeVar("TBO", bound=A | None)
TC = TypeVar("TC", A, int)


def f9(x: TB | None, y: TB):
    if x is y:
        reveal_type(x, expected_text="TB@f9")


def f9b(x: A | None, y: TB | A, witness: TB):
    if x is y:
        reveal_type(x, expected_text="A")


def f10(x: TC | None, y: TC):
    if x is y:
        reveal_type(x, expected_text="TC@f10")


def f10b(x: A | None, y: TC | A, witness: TC):
    if x is y:
        reveal_type(x, expected_text="A")


def f11(x: TBO | None, y: TBO):
    if x is y:
        reveal_type(x, expected_text="TBO@f11 | None")


TCO = TypeVar("TCO", A, None)


def f11b(x: A | None, y: TBO | A, witness: TBO):
    if x is y:
        reveal_type(x, expected_text="A | None")


def f11c(x: A | None, y: TCO | A, witness: TCO):
    if x is y:
        reveal_type(x, expected_text="A | None")


def f12(x: A | None, y: None):
    if x is y:
        reveal_type(x, expected_text="A | None")


def f13(x: A | None, y: Callable[[], A]):
    if x is y:
        reveal_type(x, expected_text="A")


class P(Protocol):
    def method(self) -> int: ...


def f14(x: A | None, y: P):
    if x is y:
        reveal_type(x, expected_text="A")


U = TypeVar("U")


class Box(Generic[U]):
    pass


def f15(x: Box[A] | None, y: Box[A]):
    if x is y:
        reveal_type(x, expected_text="Box[A]")


UserId = NewType("UserId", int)


def f16(x: UserId | None, y: UserId):
    if x is y:
        reveal_type(x, expected_text="UserId")


class TypeA(IntEnum):
    VAL1 = 1


VAL1: TypeA


def bar(t: TypeA) -> None:
    ...


def protobuf_shaped(t: TypeA | None) -> None:
    assert t is VAL1
    reveal_type(t, expected_text="TypeA")
    bar(t)


def unsafe(x: A | None, y: T | A, witness: T) -> int:
    if x is y:
        reveal_type(x, expected_text="A | None")
        return x.method()  # This should generate an error.
    return 0


unsafe(None, None, None)
