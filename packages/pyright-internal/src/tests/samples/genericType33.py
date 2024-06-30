# This sample tests the case where a contravariant TypeVar is used in a protocol.

from typing import Generic, Protocol, TypeVar

T_contra = TypeVar("T_contra", contravariant=True)


class Contra(Generic[T_contra]): ...


class Foo(Protocol[T_contra]):
    def f(self) -> Contra[T_contra]: ...


def t1(x: Foo[T_contra]) -> list[T_contra] | None: ...


def t2(x: Foo[object]) -> None: ...


def func1(x: Foo[T_contra]) -> list[T_contra] | None:
    # This should generate an error.
    t2(x)


def func2(x: Foo[object]) -> None:
    t1(x)
