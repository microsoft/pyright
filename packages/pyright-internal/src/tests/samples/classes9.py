# This sample tests incompatible method overrides for multiple inheritance.
# This functionality is controlled by the reportIncompatibleMethodOverride
# diagnostic rule.


from typing import Generic, TypeVar


class A1:
    def func1(self, a: int) -> str:
        ...


class A2:
    def func1(self, a: int, b: int = 3) -> str:
        ...


# This should generate an error because func1 is incompatible.
class ASub(A1, A2):
    ...


class B1:
    def func1(self) -> int:
        ...


class B2:
    def func1(self) -> float:
        ...


class BSub(B1, B2):
    ...


class C1:
    def func1(self) -> float:
        ...


class C2:
    def func1(self) -> int:
        ...


# This should generate an error because func1 is incompatible.
class CSub(C1, C2):
    ...


class D1:
    def func1(self, a: int) -> None:
        ...


class D2:
    def func1(self, b: int) -> None:
        ...


# This should generate an error because func1 is incompatible.
class DSub(D1, D2):
    ...


_T_E = TypeVar("_T_E")


class E1(Generic[_T_E]):
    def func1(self, a: _T_E) -> None:
        ...


class E2(Generic[_T_E]):
    def func1(self, a: _T_E) -> None:
        ...


class ESub(E1[int], E2[int]):
    ...
