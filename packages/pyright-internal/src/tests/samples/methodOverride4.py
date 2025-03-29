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
