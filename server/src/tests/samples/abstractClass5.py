# This sample tests the type checker's reporting of abstract
# overload mismatches.

from abc import ABC, abstractmethod
from typing import overload

class Foo(ABC):
    @overload
    @abstractmethod
    def func1(self, a: int) -> int:
        pass
    @overload
    @abstractmethod
    def func1(self, a: float) -> float:
        pass
    @overload
    # This should generate an error because this overload is
    # missing an abstractmethod overload.
    def func1(self, a: str) -> str:
        return ""
    

    @overload
    def func2(self, a: str) -> str:
        return ""
    @overload
    @abstractmethod
    # This should generate an error because this overload has
    # an abstractmethod overload.
    def func2(self, a: int) -> int:
        pass
    
