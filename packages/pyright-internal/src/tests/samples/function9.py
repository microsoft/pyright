# This sample tests the case where a function type is assigned to another
# and the source contains parameters that are annotated as literals and
# the destination has corresponding TypeVars.

from typing import Callable, TypeVar, Literal

_A = TypeVar("_A")


def wrapper1(fn: Callable[[_A], int]) -> _A: ...


def f1(a: Literal[0]) -> int: ...


reveal_type(wrapper1(f1), expected_text="Literal[0]")


def wrapper2(fn: Callable[..., _A]) -> Callable[..., _A]: ...


def f2() -> Literal["Foo"]:
    return "Foo"


reveal_type(wrapper2(f2)(), expected_text="Literal['Foo']")


def f3():
    return "Foo"


reveal_type(wrapper2(f3)(), expected_text="str")
