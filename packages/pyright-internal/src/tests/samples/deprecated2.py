# This sample tests the @warning.deprecated decorator introduced in PEP 702.

from contextlib import contextmanager
from typing import Any, Callable, Self, TypeVar

from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    deprecated,
    overload,
)


@deprecated("Use ClassB instead")
class ClassA: ...


# This should generate an error if reportDeprecated is enabled.
ClassA()


class ClassC:
    @deprecated("Don't temp me")
    def method1(self) -> None: ...

    @overload
    @deprecated("Int is no longer supported")
    def method2(self, a: int) -> None: ...

    @overload
    def method2(self, a: None = None) -> None: ...

    def method2(self, a: int | None = None) -> None: ...


c1 = ClassC()

# This should generate an error if reportDeprecated is enabled.
c1.method1()

c1.method2()

# This should generate an error if reportDeprecated is enabled.
c1.method2(2)


@deprecated("Test")
def func1() -> None: ...


# This should generate an error if reportDeprecated is enabled.
func1()


@overload
def func2(a: str) -> None: ...


@overload
@deprecated("int no longer supported")
def func2(a: int) -> int: ...


def func2(a: str | int) -> int | None: ...


func2("hi")

# This should generate an error if reportDeprecated is enabled.
func2(3)


class ClassD:
    @overload
    def __init__(self, x: int) -> None: ...

    @overload
    @deprecated("str no longer supported")
    def __init__(self, x: str) -> None: ...

    def __init__(self, x: int | str) -> None: ...


ClassD(3)

# This should generate an error if reportDeprecated is enabled.
ClassD("")


class ClassE:
    @overload
    def __new__(cls, x: int) -> Self: ...

    @overload
    @deprecated("str no longer supported")
    def __new__(cls, x: str) -> Self: ...

    def __new__(cls, x: int | str) -> Self: ...


ClassE(3)

# This should generate an error if reportDeprecated is enabled.
ClassE("")


@deprecated("Deprecated async function")
async def func3(): ...


async def func4():
    # This should generate an error if reportDeprecated is enabled.
    await func3()


@overload
def func5(val: int): ...


@overload
def func5(val: str): ...


@deprecated("All overloads are deprecated")
def func5(val: object): ...


# This should generate an error if reportDeprecated is enabled.
func5(1)

# This should generate an error if reportDeprecated is enabled.
func5("")

# This should generate an error if reportDeprecated is enabled.
v1 = func5


T = TypeVar("T", bound=Callable[..., Any])


@deprecated("Use different decorator")
@overload
def deco1(value: T) -> T: ...


@overload
def deco1(value: str): ...


def deco1(value: object) -> object: ...


# This should generate an error if reportDeprecated is enabled.
@deco1
def func6(): ...


@contextmanager
@deprecated("Func is deprecated")
def func7():
    yield


# This should generate an error if reportDeprecated is enabled.
with func7():
    ...


@deprecated("Func is deprecated")
@contextmanager
def func8():
    yield


# This should generate an error if reportDeprecated is enabled.
with func8():
    ...
