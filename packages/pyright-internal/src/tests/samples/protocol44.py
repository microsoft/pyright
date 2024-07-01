# This sample tests the case where protocol matching requires that the type
# parameter for the concrete class map to a union of types in the protocol.

from typing import Iterable, Protocol, TypeVar

K = TypeVar("K")
V = TypeVar("V")


class SpecialDict(Protocol[K, V]):
    def items(self) -> Iterable[tuple[K, V | int]]: ...

    def __getitem__(self, __key: K) -> V | int: ...

    def __setitem__(self, __key: K, __value: V | int) -> None: ...


def func1(k: K, v: V) -> SpecialDict[K, V]:
    x1: SpecialDict[K, V] = {k: v}
    x2: SpecialDict[K, V] = {k: v, k: 1}
    x3: SpecialDict[K, V] = {k: 0}
    return {}
