# This sample tests the case where a Callable that includes a Concatenate
# is used as an input parameter to a function that returns a generic
# type parameterized by a ParamSpec and specialized with a Concatenate.

# pyright: reportOverlappingOverload=false

from __future__ import annotations
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    Self,
    Concatenate,
    ParamSpec,
)
from typing import Any, Callable, TypeVar, Protocol, Generic, overload

T = TypeVar("T")
O = TypeVar("O")
P = ParamSpec("P")
Self_A = TypeVar("Self_A", bound="A")


class _callable_cache(Protocol[P, T]):
    foo: int = 0
    val: T

    def __init__(self, val: T) -> None:
        self.val = val

    def __call__(self, *args: P.args, **kwargs: P.kwargs) -> T:
        return self.val


class _wrapped_cache(_callable_cache[P, T], Generic[O, P, T]):
    @overload
    def __get__(  # type: ignore
        self, instance: None, owner: type[O]
    ) -> _callable_cache[Concatenate[O, P], T]: ...

    @overload
    def __get__(self, instance: O, owner: type[O]) -> Self: ...


@overload
def cache(fn: Callable[Concatenate[Self_A, P], T]) -> _wrapped_cache[Self_A, P, T]:  # type: ignore
    ...


@overload
def cache(fn: Callable[P, T]) -> _wrapped_cache[Any, P, T]: ...


@cache
def not_in_class(a: int, b: str) -> str: ...


class A:
    @cache
    def in_class(self, a: int, b: str) -> str: ...


reveal_type(not_in_class, expected_text="_wrapped_cache[Any, (a: int, b: str), str]")
not_in_class(1, "")

a = A()

reveal_type(a.in_class, expected_text="_wrapped_cache[A, (a: int, b: str), str]")
a.in_class(1, "")

reveal_type(A.in_class, expected_text="_callable_cache[(A, a: int, b: str), str]")
A.in_class(a, 1, "")
