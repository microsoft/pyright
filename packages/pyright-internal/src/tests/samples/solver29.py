# This sample tests the case where a union of two "bare" TypeVars are
# used in the annotation of a function parameter.

from typing import Any, TypeVar, Callable

S = TypeVar("S")
T = TypeVar("T")


def accepts_bool(b: bool) -> None: ...


def accepts_int(i: int) -> None: ...


def func1(x: S | T, l2: Callable[[S], Any], l3: Callable[[T], Any]) -> tuple[S, T]: ...


def func2(x: T | S, l2: Callable[[S], Any], l3: Callable[[T], Any]) -> tuple[S, T]: ...


x1 = func1(0, accepts_int, accepts_bool)
reveal_type(x1, expected_text="tuple[int, bool]")

x2 = func1(True, accepts_int, accepts_bool)
reveal_type(x2, expected_text="tuple[int, bool]")

x3 = func1(0, accepts_int, accepts_bool)
reveal_type(x3, expected_text="tuple[int, bool]")

x4 = func1(True, accepts_int, accepts_bool)
reveal_type(x4, expected_text="tuple[int, bool]")
