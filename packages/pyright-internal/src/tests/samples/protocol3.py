# This sample tests the assignment of protocols that
# include property declarations.

from typing import Protocol


class Foo1(Protocol):
    @property
    def batch_shape(self) -> int:
        return 0


class MockFoo1:
    def __init__(self, batch_shape: int):
        self._batch_shape = batch_shape

    @property
    def batch_shape(self) -> int:
        return self._batch_shape


# This should not generate an error.
d: Foo1 = MockFoo1(batch_shape=1)


class Foo2(Protocol):
    @property
    def batch_shape(self) -> int:
        return 0


class MockFoo2:
    def __init__(self, batch_shape: int):
        self._batch_shape = batch_shape

    @property
    def batch_shape(self) -> float:
        return self._batch_shape


# This should generate an error because the
# type of the batch_shape property is not compatible.
e: Foo2 = MockFoo2(batch_shape=1)


class Foo3(Protocol):
    @property
    def batch_shape(self) -> int:
        return 0

    @batch_shape.setter
    def batch_shape(self, value: int) -> None:
        pass


class MockFoo3:
    def __init__(self, batch_shape: int):
        self._batch_shape = batch_shape

    @property
    def batch_shape(self) -> int:
        return self._batch_shape


# This should generate an error because it is missing
# a setter.
f: Foo3 = MockFoo3(batch_shape=1)


class Foo4(Protocol):
    @property
    def batch_shape(self) -> int:
        return 0

    @batch_shape.deleter
    def batch_shape(self) -> None:
        pass


class MockFoo4:
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
g: Foo4 = MockFoo4(batch_shape=1)

