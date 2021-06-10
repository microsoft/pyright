# This sample tests various diagnostics related to TypeVar usage.

from typing import Callable, Generic, List, Literal, Optional, TypeVar
import typing

_T = TypeVar("_T")
_S = TypeVar("_S")


class OuterClass(Generic[_T, typing.AnyStr]):
    # This should generate an error because _S
    # isn't defined in this context.
    my_var1: _S

    my_var2: typing.AnyStr

    # This should generate an error because _T
    # is already in use.
    class InnerClass1(Generic[_T]):
        ...

    # This should generate an error because typing.AnyStr
    # is already in use.
    class InnerClass2(Generic[_S, typing.AnyStr]):
        my_var1: _S

        # This should generate an error because _T
        # is already in use in the outer class.
        my_var2: _T

    class InnerClass3:
        # This should generate an error.
        x: List[_T]

        # This should generate two errors (one for each "_T").
        def f(self, x: _T, y: _S, z: _S) -> _T:
            ...

        # THis should generate an error for typing.AnyStr.
        def g(self, x: typing.AnyStr) -> None:
            # This should generate an error.
            y: List[_T]


def func1(a: _T) -> Optional[_T]:
    my_var1: _T

    # This should generate an error
    my_var2: _S

    # This should generate an error because _T
    # is already in use.
    class InnerClass3(Generic[_T]):
        ...


# This should generate an error.
a: _S = 3

# This should generate an error.
b: List[_T] = []

# This should generate an error.
c: List[typing.AnyStr] = []


T = TypeVar("T")


def foo() -> Callable[[T], T]:
    def inner(v: T) -> T:
        t_v: Literal["T@foo"] = reveal_type(v)
        return v

    return inner
