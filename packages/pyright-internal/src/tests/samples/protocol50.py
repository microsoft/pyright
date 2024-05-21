# This sample tests the case where a protocol is used as a type argument
# for itself.

from typing import Generic, Protocol, TypeVar

V_co = TypeVar("V_co", covariant=True)


class Proto1(Generic[V_co]):
    def f(self, /) -> V_co: ...


class Proto2(Protocol[V_co]):
    def f(self, /) -> V_co: ...


def func1(v0: Proto1[Proto1[object]]):
    v2: Proto2[Proto2[object]] = v0
