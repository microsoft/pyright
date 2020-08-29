# This sample tests a protocol class that refers to itself.

from typing import Optional, Protocol


class TreeLike(Protocol):
    value: int

    @property
    def left(self) -> Optional["TreeLike"]:
        ...

    @property
    def right(self) -> Optional["TreeLike"]:
        ...


class SimpleTree:
    value: int

    @property
    def left(self) -> Optional["SimpleTree"]:
        return self._left

    @property
    def right(self) -> Optional["SimpleTree"]:
        return self._right

    def __init__(self, value: int) -> None:
        self.value = value
        self._left: Optional["SimpleTree"] = None
        self._right: Optional["SimpleTree"] = None


root: TreeLike = SimpleTree(0)
 