# This sample tests the type checker's reporting of abstract
# overload mismatches.

from abc import ABC, abstractmethod
from typing import Union, overload


class Foo(ABC):
    @overload
    def func1(self, a: int) -> int:
        pass

    @overload
    @abstractmethod
    # This should generate an error because this overload is
    # missing an abstractmethod overload.
    def func1(self, a: float) -> float:
        pass

    @overload
    def func1(self, a: str) -> str:
        ...

    def func1(self, a: Union[int, float, str]) -> Union[int, float, str]:
        raise NotImplementedError()

    @overload
    # This should generate an error because this overload has
    # an abstractmethod overload.
    def func2(self, a: str) -> str:
        ...

    @overload
    @abstractmethod
    def func2(self, a: int) -> int:
        pass

    @abstractmethod
    def func2(self, a: Union[int, str]) -> Union[int, str]:
        raise NotImplementedError()
