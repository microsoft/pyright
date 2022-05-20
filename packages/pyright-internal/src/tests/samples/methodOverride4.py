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


class Base(Generic[_TSource]):
    @abstractmethod
    def method1(
        self, mapper: Callable[[_TSource, _T1], _TResult], other: "Base[_T1]"
    ) -> "Base[_TResult]":
        raise NotImplementedError


class Subclass1(Base[_TSource]):
    def method1(
        self, mapper: Callable[[_TSource, _T2], _TResult], other: Base[_T2]
    ) -> Base[_TResult]:
        return Subclass2()


class Subclass2(Base[_TSource]):
    def method1(
        self, mapper: Callable[[_TSource, _T3], _TResult], other: Base[_T3]
    ) -> Base[_TResult]:
        return Subclass2()
