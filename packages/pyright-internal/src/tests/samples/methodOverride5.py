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
