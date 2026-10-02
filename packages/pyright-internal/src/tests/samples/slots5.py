# This sample tests instance variables initialized in __new__.

from contextlib import AbstractContextManager
from typing import Self


class TupleAssignment:
    __slots__ = ("_spam", "_ham")

    def __new__(
        cls, value: tuple[int, AbstractContextManager[None]]
    ) -> Self:
        self = super().__new__(cls)
        self._spam, self._ham = value
        return self

    def use(self):
        reveal_type(self._spam, expected_text="int")
        with self._ham:
            pass


class DirectAssignment:
    __slots__ = ("value",)

    def __new__(cls, value: str) -> Self:
        instance = object.__new__(cls)
        instance.value = value
        return instance

    def use(self):
        reveal_type(self.value, expected_text="str")


class AnnotatedSlot:
    __slots__ = ("value",)
    value: int

    def __new__(cls, value: int) -> Self:
        self = super().__new__(cls)
        self.value = value
        return self

    def use(self):
        reveal_type(self.value, expected_text="int")


class ConditionalAssignment:
    __slots__ = ("value",)

    def __new__(
        cls, value: AbstractContextManager[None], initialize: bool
    ) -> Self:
        self = super().__new__(cls)
        if initialize:
            self.value = value
        return self

    def use(self):
        with self.value:  # This should generate two errors
            pass


class Other:
    value: int


class ReturnsOther:
    __slots__ = ("value",)

    def __new__(cls) -> Other:
        self = super().__new__(cls)
        self.value = 1
        return Other()

    def use(self):
        reveal_type(self.value, expected_text="Unbound")


class EarlyReturn:
    __slots__ = ("value",)

    def __new__(
        cls, value: AbstractContextManager[None], skip: bool
    ) -> Self:
        self = super().__new__(cls)
        if skip:
            return self
        self.value = value
        return self

    def use(self):
        with self.value:  # This should generate two errors
            pass


class Base:
    __slots__ = ()


class Child(Base):
    __slots__ = ("value",)

    def __new__(cls, value: bytes) -> Self:
        self = super().__new__(cls)
        self.value = value
        return self

    def use(self):
        reveal_type(self.value, expected_text="bytes")


class NormalInit:
    __slots__ = ("value",)

    def __init__(self, value: float):
        self.value = value

    def use(self):
        reveal_type(self.value, expected_text="float")
