# This sample tests that the Self type in a Protocol subclass is partially
# specialized appropriately during protocol matching.

from typing import Generic, Protocol, TypeVar, Self

T = TypeVar("T", covariant=True)


class P0(Protocol[T]):
    def f0(self, /) -> Self:
        ...


class P1(P0[T], Protocol[T]):
    ...


class C(Generic[T]):
    def f0(self, /) -> Self:
        ...


a: P0[str] = C[str]()
b: P1[str] = C[str]()
