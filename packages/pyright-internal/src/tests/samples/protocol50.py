# This sample tests the case where a protocol is used as a type argument
# for itself.

from typing import Generic, Protocol, TypeVar

V_co = TypeVar("V_co", covariant=True)


class Proto1(Protocol[V_co]):
    def f(self, /) -> V_co: ...


class Concrete1(Generic[V_co]):
    def f(self, /) -> V_co: ...


def func1(v0: Concrete1[Concrete1[object]]):
    v2: Proto1[Proto1[object]] = v0
