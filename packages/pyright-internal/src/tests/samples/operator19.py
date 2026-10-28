# This sample tests reflected contracts that intentionally widen a normal overload.

from typing import Callable, TypeVar, overload

T1 = TypeVar("T1")
T2 = TypeVar("T2")
T3 = TypeVar("T3")


def replace_other(
    other: T2,
) -> Callable[[Callable[[T1, T2], T3]], Callable[[T1, T2], T3]]:
    def decorate(func: Callable[[T1, T2], T3]) -> Callable[[T1, T2], T3]:
        def wrapper(left: T1, right: T2) -> T3:
            return func(left, other)

        return wrapper

    return decorate


class Expr:
    def __add__(self, other: "Expr") -> "Expr":
        return Expr()

    def __radd__(self, other: "Expr", /) -> "Expr":
        return Expr()


class Number(Expr):
    @overload
    def __add__(self, other: "Number") -> "Number": ...
    @overload
    def __add__(self, other: Expr) -> Expr: ...

    def __add__(self, other: Expr) -> Expr:
        if isinstance(other, Number):
            return Number()
        return Expr()


class Integer(Number):
    @replace_other(Expr())
    def __radd__(self, other: Expr):
        return Number.__add__(self, other)


class ExactInteger(Number):
    def __radd__(self, other: Expr) -> Number:
        return Number()


def contracts(left: Number, right: Integer, exact: ExactInteger):
    reveal_type(left.__add__(right), expected_text="Number")
    reveal_type(right.__radd__(left), expected_text="Expr")
    reveal_type(left + right, expected_text="Expr")
    reveal_type(left + exact, expected_text="Number")


def wrong_return(left: Number, right: Integer) -> Number:
    # This should generate an error rather than use the normal overload's return.
    return left + right


def exact_return(left: Number, right: ExactInteger) -> Number:
    return left + right
