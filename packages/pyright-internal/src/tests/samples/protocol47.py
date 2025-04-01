# This sample tests protocol matching for a protocol and an implementation
# that use a mixture of class-scoped and function-scoped TypeVars.

from typing import Generic, Protocol, TypeVar

T1 = TypeVar("T1", covariant=True)
T2 = TypeVar("T2")


class ProtoA(Protocol[T1]):
    def method1(self, __key: str, __default: T2) -> "T1 | T2": ...


T3 = TypeVar("T3", covariant=True)
T4 = TypeVar("T4")


class A(Generic[T3]):
    def method1(self, key: str, default: T4) -> "T3 | T4":
        raise NotImplementedError


a1: A[str] = A()


def func1(storage: ProtoA[str]): ...


v1: ProtoA[str] = a1
func1(a1)


def func2(storage: ProtoA[int]): ...


# This should generate an error.
v2: ProtoA[int] = a1

# This should generate an error.
func2(a1)
