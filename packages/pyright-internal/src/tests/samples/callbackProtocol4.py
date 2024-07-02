# This sample tests the case where a callback protocol uses
# an overloaded __call__ method.

from typing import Any, Protocol, overload


class P1(Protocol):
    @overload
    def __call__(self, x: int) -> int: ...

    @overload
    def __call__(self, x: str) -> str: ...

    def __call__(self, x: Any) -> Any: ...


def func0(x: Any) -> Any:
    return x


def func1(x: int) -> Any:
    return x


a0: P1 = func0

# This should generate an error
a1: P1 = func1


@overload
def of1(x: int) -> int: ...


@overload
def of1(x: str) -> str: ...


def of1(x: Any) -> Any:
    return x


@overload
def of2(x: int) -> complex: ...


@overload
def of2(x: str) -> str: ...


def of2(x: Any) -> Any:
    return x


b0: P1 = of1

# This should generate an error
b1: P1 = of2


class P2(Protocol):
    def __call__(self, *args: int) -> Any: ...


a: P2 = lambda *args: map(lambda arg: arg + 0, args)
