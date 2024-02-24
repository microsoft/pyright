# This sample tests the case where a classmethod or staticmethod are
# used with a TypeVarTuple that requires specialization.

from typing import Generic

from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    TypeVarTuple,
    Unpack,
)

T2 = TypeVarTuple("T2")


class Base(Generic[Unpack[T2]]):
    @classmethod
    def method1(cls, *args: Unpack[T2]) -> int: ...

    @staticmethod
    def method2(*args: Unpack[T2]) -> int: ...


class Child(Base[int, str]): ...


Child.method1(1, "")
Child.method2(1, "")
