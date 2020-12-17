# This sample tests that ParamSpecs support parameters with default values.

from typing import Callable, ParamSpec, TypeVar

V = TypeVar("V")
P = ParamSpec("P")


def foo(fn: Callable[P, V]) -> Callable[P, V]:
    ...


def bar(baz: str, qux: str = "") -> str:
    ...


foo(bar)("")
