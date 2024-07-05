# This sample tests the case where a generic function call is nested
# within itself.

from typing import Callable, ParamSpec, Protocol, Type, TypeVar, Union, overload
from itertools import chain

P = ParamSpec("P")
R = TypeVar("R")
T = TypeVar("T", covariant=True)


def func1():
    return [
        f"{12 if hour == 0 else hour!s}:{minute!s:0>2} {meridian}"
        for hour, minute, meridian in chain.from_iterable(
            chain.from_iterable(
                [(hour, minute, meridian) for minute in range(0, 60, 15)]
                for hour in range(12)
            )
            for meridian in ("am", "pm")
        )
    ]


class A(Protocol[T, P]):
    def __init__(self, *args: P.args, **kwds: P.kwargs): ...


def make_a(x: Callable[P, R]) -> Type[A[R, P]]: ...


@overload
def func2(x: Type[A[R, P]]) -> Type[A[R, P]]: ...


@overload
def func2(x: Callable[P, R]) -> Type[A[R, P]]: ...


def func2(x: Union[Type[A[R, P]], Callable[P, R]]) -> Type[A[R, P]]: ...


def func3():
    def foo(x: int) -> str: ...

    x = make_a(foo)
    y = func2(x)
    z = func2(make_a(foo))

    reveal_type(y, expected_text="type[A[str, (x: int)]]")
    reveal_type(z, expected_text="type[A[str, (x: int)]]")


def func4(my_dict: dict[str, str]):
    reveal_type(my_dict.get("item1", ""), expected_text="str")
    reveal_type(my_dict.get("item1", my_dict.get("item2", "")), expected_text="str")
