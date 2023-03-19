# This sample tests the @typing.deprecated decorator introduced in PEP 702.

from typing import Self
from typing_extensions import deprecated, overload


@deprecated("Use ClassB instead")
class ClassA:
    ...


# This should generate an error if reportDeprecated is enabled.
ClassA()


class ClassC:
    @deprecated("Don't temp me")
    def method1(self) -> None:
        ...

    @overload
    @deprecated("Int is no longer supported")
    def method2(self, a: int) -> None:
        ...

    @overload
    def method2(self, a: None = None) -> None:
        ...

    def method2(self, a: int | None = None) -> None:
        ...


c1 = ClassC()

# This should generate an error if reportDeprecated is enabled.
c1.method1()

c1.method2()

# This should generate an error if reportDeprecated is enabled.
c1.method2(2)


@deprecated("Test")
def func1() -> None:
    ...


# This should generate an error if reportDeprecated is enabled.
func1()


@overload
def func2(a: str) -> None:
    ...


@overload
@deprecated("int no longer supported")
def func2(a: int) -> int:
    ...


def func2(a: str | int) -> int | None:
    ...


func2("hi")

# This should generate an error if reportDeprecated is enabled.
func2(3)


class ClassD:
    @overload
    def __init__(self, x: int) -> None:
        ...

    @overload
    @deprecated("str no longer supported")
    def __init__(self, x: str) -> None:
        ...

    def __init__(self, x: int | str) -> None:
        ...


ClassD(3)

# This should generate an error if reportDeprecated is enabled.
ClassD("")
