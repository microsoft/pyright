# This sample tests a case where a protocol method has a method-scoped
# type parameter.

from typing import Callable, Generic, Protocol, TypeVar

S = TypeVar("S")
T = TypeVar("T")
Input = TypeVar("Input")
Output = TypeVar("Output")


class Proto1(Protocol):
    def __call__(self, item: S, /) -> S: ...


class Impl1:
    def __call__(self, item: T, /) -> T:
        return item


class Wrapper(Generic[Input, Output]):
    def __init__(self, f: Callable[[Input], Output]) -> None:
        self.__f = f

    def __call__(self, item: Input, /) -> Output:
        return self.__f(item)


y = Wrapper(Impl1())
reveal_type(y, expected_text="Wrapper[T@__call__, T@__call__]")
x: Proto1 = y
