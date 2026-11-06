# This sample tests an edge case where a base method uses an unpacked
# tuple or a specialized TypeVarTuple and is overridden by a method
# that supplies specific arguments.

# pyright: strict

from typing import Generic, TypeVarTuple

Ts = TypeVarTuple("Ts")


class Parent(Generic[*Ts]):
    def method_1(self, *args: *Ts) -> None: ...

    def method_2(self, *args: *tuple[*Ts]) -> None: ...


class Child(Parent[int]):
    def method_1(self, arg1: int) -> None: ...

    def method_2(self, arg1: int) -> None: ...


class Parent2:
    def method_1(self, *args: *tuple[bytes, int]) -> None: ...


class Child2(Parent2):
    def method_1(self, arg1: bytes, arg2: int, /) -> None: ...


class Child3(Parent2):
    # This should generate an error.
    def method_1(self, arg1: bytes, arg2: str, /) -> None: ...
