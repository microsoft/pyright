# This sample tests the logic that infers parameter types based on
# annotated base class methods when the base class is generic.

# pyright: reportIncompatibleMethodOverride=false

from typing import Callable, Generic, ParamSpec, TypeVar

T = TypeVar("T")
P = ParamSpec("P")
R = TypeVar("R")


class Parent1(Generic[T]):
    def method1(self, a: T, b: list[T]) -> None: ...


class Child1(Parent1[float]):
    def method1(self, a, b):
        reveal_type(self, expected_text="Self@Child1")
        reveal_type(a, expected_text="float")
        reveal_type(b, expected_text="list[float]")
        return a


class Parent2:
    def method1(self, fn: Callable[P, R], *args: P.args, **kwargs: P.kwargs) -> R:
        return fn(*args, **kwargs)


class Child2(Parent2):
    def method1(self, fn, *args, **kwargs):
        reveal_type(self, expected_text="Self@Child2")
        reveal_type(fn, expected_text="(...) -> Unknown")
        reveal_type(args, expected_text="tuple[Unknown, ...]")
        reveal_type(kwargs, expected_text="dict[str, Unknown]")
        return super().method1(fn, *args, **kwargs)
