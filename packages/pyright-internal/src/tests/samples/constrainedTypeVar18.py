# This sample tests the case where an inferred method return type is
# a union with subtypes that are conditioned on different constraints of
# a constrained TypeVar. When the method is bound, one or more of these
# subtypes should be eliminated.

from typing import Generic, TypeVar, Awaitable

T1 = TypeVar("T1")


class Async:
    def fn(self, returnable: T1) -> Awaitable[T1]: ...


class Sync:
    def fn(self, returnable: T1) -> T1: ...


T2 = TypeVar("T2", Async, Sync)


class A(Generic[T2]):
    def __init__(self, client: T2):
        self._client = client

    def method1(self):
        return self._client.fn(7)


a1 = A(Async())
r1 = a1.method1()
reveal_type(r1, expected_text="Awaitable[int]*")

a2 = A(Sync())
r2 = a2.method1()
reveal_type(r2, expected_text="int*")
