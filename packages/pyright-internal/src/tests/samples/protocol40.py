# This sample tests that the Self type in a Protocol subclass is partially
# specialized appropriately during protocol matching.

from typing import Generic, Protocol, TypeVar, Self

T = TypeVar("T", covariant=True)
S = TypeVar("S", covariant=True)


class P1Parent(Protocol[S]):
    def f0(self, /) -> Self: ...


class P1Child(P1Parent[S], Protocol[S]): ...


class C1(Generic[T]):
    def f0(self, /) -> Self: ...


a1: P1Parent[str] = C1[str]()
b1: P1Child[str] = C1[str]()


class P2Parent(Protocol[T]):
    def f0(self, right: Self, /) -> "P2Parent[T]":
        return right


class P2Child(P2Parent[T], Protocol[T]): ...


class C2(Generic[S]):
    def f0(self, other: Self) -> "C2[S]":
        return other


a2: P2Parent[str] = C2[str]()
b2: P2Child[str] = C2[str]()
