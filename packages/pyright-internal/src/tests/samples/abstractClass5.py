# This sample tests the type checker's reporting of abstract
# overload mismatches.

from abc import ABC, abstractmethod
from typing import Union, overload


class ClassA(ABC):
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
    def func1(self, a: str) -> str: ...

    def func1(self, a: Union[int, float, str]) -> Union[int, float, str]:
        raise NotImplementedError()

    @overload
    def func2(self, a: str) -> str: ...

    @overload
    @abstractmethod
    def func2(self, a: int) -> int:
        pass

    @abstractmethod
    def func2(self, a: Union[int, str]) -> Union[int, str]:
        raise NotImplementedError()

    @overload
    def func3(self, a: str) -> str:  # pyright: ignore[reportNoOverloadImplementation]
        ...

    @overload
    @abstractmethod
    # This should generate an error because the abstract status is inconsistent.
    def func3(self, a: int) -> int: ...

    @overload
    @abstractmethod
    def func4(self, a: str) -> str:  # pyright: ignore[reportNoOverloadImplementation]
        ...

    @overload
    # This should generate an error because the abstract status is inconsistent.
    def func4(self, a: int) -> int: ...
