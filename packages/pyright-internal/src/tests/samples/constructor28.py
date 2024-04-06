# This sample tests the case where a constructor for a class is invoked
# multiple times as separate arguments for a call.

# pyright: strict

from __future__ import annotations
from typing import Any, Callable, Generic, Iterable, TypeVar, overload

T = TypeVar("T")
S = TypeVar("S", covariant=True)


class ParentA: ...


class ChildA(ParentA, Generic[T]):
    def __init__(self, a: T) -> None: ...


def func1(arg1: ParentA, arg2: ParentA): ...


func1(ChildA(1), ChildA(2))


class ParentB(Generic[T]): ...


class ChildB(ParentB[T]):
    def __init__(self, a: T) -> None: ...


def func2(arg1: ParentB[T], arg2: ParentB[T]) -> T: ...


# This should generate an error.
func2(ChildB(""), ChildB(1.2))


class ClassC(Generic[S]):
    def __new__(cls, item: S) -> "ClassC[S]": ...

    def __call__(self, obj: Any) -> S: ...


def func3(func1: Callable[..., T], func2: Callable[..., T]) -> T: ...


x2 = func3(ClassC(""), ClassC(1))
reveal_type(x2, expected_text="str | int")


class ClassD(Generic[S]):
    @overload
    def __new__(cls, item: S, /) -> ClassD[S]: ...

    @overload
    def __new__(cls, item: S, __item2: S, /) -> ClassD[tuple[S, S]]: ...

    def __new__(cls, *items: Any) -> Any: ...

    def __call__(self, obj: Any) -> Any: ...


func3(ClassD(""), ClassD(""))


def func4(a: Iterable[tuple[str, ...]]):
    zip(a, zip(*a))
