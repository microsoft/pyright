# This sample tests the case where an inferred method return type is
# a union with subtypes that are conditioned on different constraints of
# a constrained TypeVar. When the method is bound, one or more of these
# subtypes should be eliminated.

from typing import Generic, TypeVar, Awaitable

T = TypeVar("T")


class Async:
    def fn(self, returnable: T) -> Awaitable[T]: ...


class Sync:
    def fn(self, returnable: T) -> T: ...


T = TypeVar("T", Async, Sync)


class A(Generic[T]):
    def __init__(self, client: T):
        self._client = client

    def method1(self):
        return self._client.fn(7)


a1 = A(Async())
r1 = a1.method1()
reveal_type(r1, expected_text="Awaitable[int]*")

a2 = A(Sync())
r2 = a2.method1()
reveal_type(r2, expected_text="int*")
