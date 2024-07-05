# This sample tests protocol matching for multiple protocols that refer
# to each other in a recursive fashion. In particular, this sample tests
# the case where a "cls" parameter is annotated with a protocol type.

from typing import Never, Self, TypeVar, Protocol

T_contra = TypeVar("T_contra", contravariant=True)
T = TypeVar("T")


class ProtoA(Protocol[T_contra, T]):
    def method1(self, value: T_contra) -> "ProtoA[T_contra, T]": ...

    @classmethod
    def method2(cls, value: T) -> T: ...


class ProtoB(Protocol[T_contra, T]):
    def method3(self) -> ProtoA[T_contra, T]: ...


class ImplA:
    def method1(self, value: int) -> Self: ...

    @classmethod
    def method2(cls, value: int) -> int: ...


class ImplB:
    def method3(self) -> ImplA: ...

    def method1(self, value: int) -> Self: ...

    @classmethod
    def method2(cls: type[ProtoB[Never, T]], value: list[T]) -> list[T]: ...


def func1(x: ProtoA[Never, T]) -> T: ...


v1 = func1(ImplB())
reveal_type(v1, expected_text="list[int]")
