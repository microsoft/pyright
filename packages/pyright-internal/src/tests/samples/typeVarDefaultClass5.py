# This sample tests support for PEP 696 -- default types for TypeVars.
# In particular, it tests that class-level TypeVars with defaults can
# still be inferred from classmethod arguments.

from typing import Generic, Protocol, Self, assert_type

from typing_extensions import TypeVar  # pyright: ignore[reportMissingModuleSource]

T = TypeVar("T", default=int)
U = TypeVar("U")
T_co = TypeVar("T_co", default=int, covariant=True)


class Factory(Protocol[T_co]):
    def __call__(self) -> T_co: ...


class ClassA(Generic[T]):
    @classmethod
    def create(cls, *, factory: Factory[T] | None = None) -> Self: ...

    def method(self) -> T: ...


def str_factory() -> str: ...


# No factory - should use default.
v1 = ClassA.create()
assert_type(v1, ClassA[int])

# With factory - should infer from argument, not use default.
v2 = ClassA.create(factory=str_factory)
assert_type(v2, ClassA[str])


class SubA(ClassA[T]):
    pass


# Subclass without factory - should use default.
v3 = SubA.create()
assert_type(v3, SubA[int])

# Subclass with factory - should infer from argument.
v4 = SubA.create(factory=str_factory)
assert_type(v4, SubA[str])


# Direct parameter pattern (not wrapped in Protocol).
class ClassB(Generic[T]):
    @classmethod
    def from_value(cls, value: T) -> Self: ...

v5 = ClassB.from_value("hello")
assert_type(v5, ClassB[str])

v6 = ClassB.from_value(42)
assert_type(v6, ClassB[int])


# Mixed TypeVars: one with default, one without.
class ClassC(Generic[U, T]):
    @classmethod
    def build(cls, key: U, *, factory: Factory[T] | None = None) -> Self: ...

v7 = ClassC.build("key", factory=str_factory)
assert_type(v7, ClassC[str, str])

v8 = ClassC.build("key")
assert_type(v8, ClassC[str, int])


# Instance method should still get defaults applied.
v9 = ClassA[int]()
assert_type(v9.method(), int)
