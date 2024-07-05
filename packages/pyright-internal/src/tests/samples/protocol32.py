# This sample tests the case where a protocol class derives from
# another protocol class.

from typing import Generic, TypeVar, Protocol, overload

Arg = TypeVar("Arg", contravariant=True)
Value = TypeVar("Value")


class Base1(Protocol[Value]):
    def method1(self, default: Value) -> Value: ...


class Base2(Base1[Value], Protocol):
    def method2(self, default: Value) -> Value: ...


class Interface(Base2[Value], Protocol[Arg, Value]):
    def another(self, arg: Arg) -> None: ...


class Implementation1(Generic[Arg, Value]):
    def method1(self, default: Value) -> Value:
        return default

    def method2(self, default: Value) -> Value:
        return default

    def another(self, arg: Arg) -> None:
        return


def func1(arg: Arg, value: Value) -> Interface[Arg, Value]:
    return Implementation1[Arg, Value]()


class Implementation2(Generic[Arg, Value]):
    def method1(self, default: Value) -> Value:
        return default

    def another(self, arg: Arg) -> None:
        return


def func2(arg: Arg, value: Value) -> Interface[Arg, Value]:
    # This should generate an error because
    # Implementation2 doesn't implement method2.
    return Implementation2[Arg, Value]()


class Implementation3(Generic[Arg, Value]):
    def method1(self, default: int) -> int:
        return default

    def method2(self, default: Value) -> Value:
        return default

    def another(self, arg: Arg) -> None:
        return


def func3(arg: Arg, value: Value) -> Interface[Arg, Value]:
    # This should generate an error because
    # Implementation3's signature doesn't match.
    return Implementation3[Arg, Value]()


class Base4(Protocol):
    @overload
    def method3(self, message: int) -> int: ...

    @overload
    def method3(self, message: str) -> str: ...

    def method3(self, message: str | int):
        return message


class Implementation4(Base4): ...
