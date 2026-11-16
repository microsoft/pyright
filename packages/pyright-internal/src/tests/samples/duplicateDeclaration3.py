# This sample tests generic function redeclarations in separate statement suites.

from collections.abc import Callable
from typing import ParamSpec, TypeVar, assert_type

P = ParamSpec("P")
R = TypeVar("R")
T = TypeVar("T")

try:
    import sys
except ImportError:
    def fgen(func: Callable[P, R]) -> Callable[P, R]:
        return func

    def identity(value: T) -> T:
        return value
else:
    def fgen(func: Callable[P, R]) -> Callable[P, R]:
        return func

    def identity(value: T) -> T:
        return value


def example(value: int, *, label: str) -> bool:
    return bool(value and label)


assert_type(fgen(example)(1, label="test"), bool)
assert_type(identity(1), int)


def conditional_generics(condition: bool) -> None:
    if condition:
        def pep695[T](value: T) -> list[T]:
            return [value]

        def decorate[**P, R](func: Callable[P, R]) -> Callable[P, R]:
            return func

        def pack[*Ts](*values: *Ts) -> tuple[*Ts]:
            return values

        def defaulted[T = int](value: T | None = None) -> T | None:
            return value
    else:
        def pep695[U](value: U) -> list[U]:
            return [value]

        def decorate[**Q, S](func: Callable[Q, S]) -> Callable[Q, S]:
            return func

        def pack[*Us](*values: *Us) -> tuple[*Us]:
            return values

        def defaulted[U = int](value: U | None = None) -> U | None:
            return value

    assert_type(pep695(1), list[int])
    assert_type(decorate(example)(1, label="test"), bool)
    assert_type(pack(1, "text"), tuple[int, str])


class GenericMethods[U]:
    def define(self, condition: bool, outer: U) -> None:
        if condition:
            def captured[T](value: T) -> tuple[U, T]:
                return outer, value
        else:
            def captured[V](value: V) -> tuple[U, V]:
                return outer, value
        assert_type(captured(1), tuple[U, int])
