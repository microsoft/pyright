# This sample tests a recursive protocol class (i.e. a protocol
# that refers to itself).

from typing import Protocol


class TreeLike(Protocol):
    value: int

    @property
    def left(self) -> "TreeLike | None": ...

    @property
    def right(self) -> "TreeLike | None": ...


class SimpleTree:
    value: int

    @property
    def left(self) -> "SimpleTree | None":
        return self._left

    @property
    def right(self) -> "SimpleTree | None":
        return self._right

    def __init__(self, value: int) -> None:
        self.value = value
        self._left: SimpleTree | None = None
        self._right: SimpleTree | None = None


root: TreeLike = SimpleTree(0)


class ProtoA(Protocol):
    def method1(self) -> "ProtoA": ...


class ImplA:
    class CallableClass:
        def __call__(self) -> "ImplA":
            return ImplA()

    method1 = CallableClass()


v1: ProtoA = ImplA()
