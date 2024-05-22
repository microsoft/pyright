# This sample tests various diagnostics related to TypeVar usage.

from typing import Callable, Generic, TypeVar, AnyStr

_T = TypeVar("_T")
_S = TypeVar("_S")


class OuterClass(Generic[_T, AnyStr]):
    # This should generate an error because _S
    # isn't defined in this context.
    my_var1: _S

    my_var2: AnyStr

    # This should generate an error because _T
    # is already in use.
    class InnerClass1(Generic[_T]): ...

    # This should generate an error because AnyStr
    # is already in use.
    class InnerClass2(Generic[_S, AnyStr]):
        my_var1: _S

        # This should generate an error because _T
        # is already in use in the outer class.
        my_var2: _T

    class InnerClass3:
        # This should generate an error.
        x: list[_T]

        def f(self, x: _T, y: _S, z: _S) -> _T: ...

        def g(self, x: AnyStr) -> None:
            # This should generate an error.
            y: list[_T]


def func1(a: _T) -> _T | None:
    my_var1: _T

    # This should generate an error
    my_var2: _S

    # This should generate an error because _T
    # is already in use.
    class InnerClass3(Generic[_T]): ...


# This should generate an error.
a: _S = 3

# This should generate an error.
b: list[_T] = []

# This should generate an error.
c: list[AnyStr] = []


T = TypeVar("T")


def foo() -> Callable[[T], T]:
    def inner(v: T) -> T:
        reveal_type(v, expected_text="T@foo")
        return v

    return inner


# This should generate an error.
list[T]()
