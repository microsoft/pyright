# This sample tests the case where a generic alias refers to a Callable
# type and the alias is used without type arguments.

from typing import Callable, ParamSpec, TypeVar

T = TypeVar("T")
P = ParamSpec("P")

TA1 = Callable[[T], T]
TA2 = Callable[[T], T] | Callable[P, T]


def f1() -> TA1: ...


reveal_type(f1(), expected_text="(Unknown) -> Unknown")


def f2() -> TA2: ...


g2 = f2()
reveal_type(
    g2,
    expected_text="((Unknown) -> Unknown) | ((...) -> Unknown)",
)
reveal_type(g2(42), expected_text="Unknown")
