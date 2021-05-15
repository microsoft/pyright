# This sample tests the type checker's handling of
# generic protocols with invariant, constrained, and contravariant
# type arguments.

from typing import Optional, TypeVar, Protocol


T = TypeVar("T")
StrLike = TypeVar("StrLike", str, bytes)
T_contra = TypeVar("T_contra", contravariant=True)


class Writer(Protocol[T_contra]):
    def write(self, data: T_contra) -> None:
        ...


class WriteFile:
    def write(self, data: bytes) -> None:
        pass


def f(writer: Writer[bytes]):
    pass


def g(writer: Writer[T], v: Optional[T] = None):
    pass


def h(writer: Writer[StrLike], v: Optional[StrLike] = None):
    pass


w = WriteFile()
f(w)
g(w)
h(w)
