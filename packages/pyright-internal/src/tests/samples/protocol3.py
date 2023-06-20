# This sample tests the assignment of protocols that
# include property declarations.

from typing import ContextManager, Protocol, TypeVar


class Class1(Protocol):
    @property
    def batch_shape(self) -> int:
        return 0


class MockClass1:
    def __init__(self, batch_shape: int):
        self._batch_shape = batch_shape

    @property
    def batch_shape(self) -> int:
        return self._batch_shape


# This should not generate an error.
d: Class1 = MockClass1(batch_shape=1)


class Class2(Protocol):
    @property
    def batch_shape(self) -> int:
        return 0


class MockClass2:
    def __init__(self, batch_shape: int):
        self._batch_shape = batch_shape

    @property
    def batch_shape(self) -> float:
        return self._batch_shape


# This should generate an error because the
# type of the batch_shape property is not compatible.
e: Class2 = MockClass2(batch_shape=1)


class Class3(Protocol):
    @property
    def batch_shape(self) -> int:
        return 0

    @batch_shape.setter
    def batch_shape(self, value: int) -> None:
        pass


class MockClass3:
    def __init__(self, batch_shape: int):
        self._batch_shape = batch_shape

    @property
    def batch_shape(self) -> int:
        return self._batch_shape


# This should generate an error because it is missing
# a setter.
f: Class3 = MockClass3(batch_shape=1)


class Class4(Protocol):
    @property
    def batch_shape(self) -> int:
        return 0

    @batch_shape.deleter
    def batch_shape(self) -> None:
        pass


class MockClass4:
    def __init__(self, batch_shape: int):
        self._batch_shape = batch_shape

    @property
    def batch_shape(self) -> int:
        return self._batch_shape

    @batch_shape.setter
    def batch_shape(self, value: int) -> None:
        pass


# This should generate an error because it is missing
# a deleter.
g: Class4 = MockClass4(batch_shape=1)


_T_co = TypeVar("_T_co", covariant=True)
_Self = TypeVar("_Self")


class Class5:
    @property
    def real(self: _Self) -> _Self:
        ...


class MockClass5(Protocol[_T_co]):
    @property
    def real(self) -> _T_co:
        ...


foo5 = Class5()
h: MockClass5[Class5] = foo5


P6 = TypeVar("P6", bound="MockClass6")
C6 = TypeVar("C6", bound="Class6")


class MockClass6(Protocol):
    @property
    def bar(self: P6) -> ContextManager[P6]:
        ...


class Class6:
    @property
    def bar(self: C6) -> ContextManager[C6]:
        ...


i: MockClass6 = Class6()
