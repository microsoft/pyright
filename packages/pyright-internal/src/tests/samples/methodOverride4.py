# This sample tests the handling of methods that combine TypeVars
# from a class and local method TypeVars in an override.

# pyright: strict

from abc import abstractmethod
from typing import Callable, Generic, TypeVar

_TSource = TypeVar("_TSource")
_TResult = TypeVar("_TResult")

_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2")
_T3 = TypeVar("_T3")


class BaseA(Generic[_TSource]):
    @abstractmethod
    def method1(
        self, mapper: Callable[[_TSource, _T1], _TResult], other: "BaseA[_T1]"
    ) -> "BaseA[_TResult]":
        raise NotImplementedError


class SubclassA1(BaseA[_TSource]):
    def method1(
        self, mapper: Callable[[_TSource, _T2], _TResult], other: BaseA[_T2]
    ) -> BaseA[_TResult]:
        return SubclassA2()


class SubclassA2(BaseA[_TSource]):
    def method1(
        self, mapper: Callable[[_TSource, _T3], _TResult], other: BaseA[_T3]
    ) -> BaseA[_TResult]:
        return SubclassA2()


class BaseB:
    def f(self, v: str) -> str: ...


class SubclassB1(BaseB):
    def f[T](self, v: T) -> T: ...


class BaseC:
    def method1[T: BaseC](self, x: T) -> T: ...


class SubclassC(BaseC):
    # This should generate an error because of the upper bound.
    def method1[T: SubclassC](self, x: T) -> T: ...


class BaseD:
    def method1(self) -> int: ...


class SubclassD[T](BaseD):
    # This should generate an error.
    def method1[S](self: "SubclassD[S]") -> S | int: ...


class BaseE:
    def method1(self) -> object: ...


class SubclassE[T](BaseE):
    def method1[S](self: "SubclassE[S]") -> S | int: ...


class BaseF:
    def method1(self, x: int) -> int: ...


class SubclassF1(BaseF):
    def method1[T](self, x: int | T) -> T | int: ...


class SubclassF2(BaseF):
    # This should generate an error because of a return type mismatch.
    def method1[T: str](self, x: int | T) -> T | int: ...


class SubclassF3(BaseF):
    # This should generate an error because of a return type mismatch.
    def method1[T: (str, bytes)](self, x: int | T) -> T | int: ...


class SubclassF4[T](BaseF):
    # This should generate an error because of a parameter type mismatch.
    def method1[S](self: "SubclassF4[S]", x: S) -> int: ...


class BaseG:
    @classmethod
    def method1(cls, x: int) -> int: ...


class SubclassG[T](BaseG):
    # This should generate an error because of a parameter type mismatch.
    @classmethod
    def method1[S](cls: "type[SubclassG[S]]", x: S) -> int: ...


class BaseH[T]:
    def method1[S](self: "BaseH[S]", x: S) -> S: ...


class SubclassH(BaseH[int]):
    def method1(self, x: int) -> int: ...


class BaseI[T]:
    def method1[S](self: "BaseI[S]", x: S) -> int: ...


# This should generate an error because the base classes define
# method1 in an incompatible way.
class SubclassI(BaseI[str], BaseF): ...


class BaseJ:
    def method1[T: BaseJ](self: T, x: T) -> None: ...


class SubclassJ1(BaseJ):
    # This should generate an error because of a parameter type mismatch.
    def method1[T: SubclassJ1](self: T, x: T) -> None: ...


class SubclassJ2(BaseJ):
    # This should generate an error because of a parameter type mismatch.
    def method1(self, x: "SubclassJ2") -> None: ...


class BaseK[T]:
    def method1[S](self: "BaseK[S]", x: S) -> S: ...


class BaseL[T]:
    def method1(self, x: T) -> T: ...


class SubclassK1[T](BaseK[T], BaseL[T]): ...


# This should generate an error because the base classes define
# method1 in an incompatible way.
class SubclassK2[T](BaseK[T], BaseF): ...


class BaseM[T]:
    def method1[S](self: "BaseM[S]", x: "BaseM[S]") -> None: ...


class BaseN[T]:
    def method1(self, x: BaseM[T]) -> None: ...


class SubclassM1[T](BaseM[T]):
    def method1(self, x: BaseM[T]) -> None: ...


class SubclassM2[T](BaseM[T]):
    def method1[S](self: "SubclassM2[S]", x: BaseM[S]) -> None: ...


# This should generate an error because the base classes define
# method1 in an incompatible way.
class SubclassM3[T](BaseM[int], BaseN[T]): ...
