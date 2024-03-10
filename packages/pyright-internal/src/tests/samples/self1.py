# This sample tests various error conditions for the Self type

from typing import Callable, Generic, TypeVar
from typing_extensions import Self  # pyright: ignore[reportMissingModuleSource]


T = TypeVar("T")


# This should generate an error because Self can't be used in this context.
class A(Self): ...


# This should generate an error because Self can't be used in this context.
x: Self


def func1() -> None:
    # This should generate an error because Self can't be used in this context.
    x: Self


# This should generate an error because Self can't be used in this context.
def func2(a: Self) -> None: ...


# This should generate an error because Self can't be used in this context.
def func3() -> Self: ...


def is_self(t: object):
    return t is Self


class B:
    x: Self

    def method1(self) -> Self:
        return self

    def method2(self, a: Self) -> None:
        x: Self = a
        y = Self

    def method3(self: Self) -> Self:
        # This should generate an error because Self doesn't accept a type arg.
        y: Self[int]
        return self

    # This should generate an error because Self can't be used with
    # methods that declare a non-Self type for "self".
    def method4(self: T, a: Self) -> T:
        # This should generate an error because Self can't be used with
        # methods that declare a non-Self type for "self".
        x: Self

        return self

    @classmethod
    def method5(cls) -> type[Self]:
        return cls

    @classmethod
    def method6(cls, a: Self) -> None: ...

    @classmethod
    def method7(cls: type[Self]) -> type[Self]:
        return cls

    # This should generate an error because Self can't be used with
    # methods that declare a non-Self type for "self".
    @classmethod
    def method8(cls: type[T], a: Self) -> type[T]:
        # This should generate an error because Self can't be used with
        # methods that declare a non-Self type for "self".
        x: Self
        return cls

    # This should generate an error because Self can't be used in
    # a static method.
    @staticmethod
    def stat_method1(a: Self) -> None:
        # This should generate an error because Self can't be used in
        # a static method.
        x: Self


class C:
    @classmethod
    def outer(cls) -> Callable[[int, Self], Self]:
        def inner(_: int, bar: Self) -> Self:
            return bar

        return inner


class D(Generic[T]): ...


# This should generate an error because "Self" cannot be used
# within a generic class definition.
class E(D[Self]): ...


class MetaA(type):
    # This should generate an error because "Self" isn't
    # allowed in a metaclass.
    def __new__(cls, *args: object) -> Self: ...

    # This should generate an error because "Self" isn't
    # allowed in a metaclass.
    def __mul__(cls, count: int) -> list[Self]: ...
