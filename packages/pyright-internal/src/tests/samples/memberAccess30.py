# This sample tests that inferred instance members do not replace inherited
# method and property contracts when reading or writing an attribute.

from typing import Callable, Protocol, final


class IntCallback(Protocol):
    def __call__(self, value: int) -> int: ...


class Base:
    def method(self, value: int) -> int:
        return value + 1


class BadReplacement(Base):
    def __init__(self, callback: Callable[[str], str]):
        # This should generate an error because the inherited signature is incompatible.
        self.method = callback


class GoodReplacement(Base):
    def __init__(self, callback: IntCallback):
        self.method = callback


class StoreBoundMethod(Base):
    def __init__(self):
        self.method = self.method


class StoreSavedBoundMethod(Base):
    def __init__(self):
        saved = self.method
        self.method = saved


def func1(direct: StoreBoundMethod, saved: StoreSavedBoundMethod, good: GoodReplacement):
    reveal_type(direct.method, expected_text="(value: int) -> int")
    reveal_type(direct.method(3), expected_text="int")
    reveal_type(saved.method(3), expected_text="int")
    reveal_type(good.method(3), expected_text="int")


class ReadOnly:
    @property
    def value(self) -> int:
        return 7


class BadReadOnly(ReadOnly):
    def __init__(self):
        # This should generate an error because the property has no setter.
        self.value = 8


class Writable:
    @property
    def value(self) -> int:
        return 7

    @value.setter
    def value(self, new_value: int) -> None:
        pass


class BadWritable(Writable):
    def __init__(self):
        # This should generate an error because the setter accepts int.
        self.value = "bad"


class GoodWritable(Writable):
    def __init__(self):
        self.value = 8


def func2(read_only: BadReadOnly, writable: BadWritable, good: GoodWritable):
    reveal_type(writable.value, expected_text="int")
    reveal_type(good.value, expected_text="int")
    # This should generate an error because the property has no setter.
    read_only.value = 9
    # This should generate an error because the setter accepts int.
    writable.value = "bad"


class GenericBase[T]:
    def method(self, value: int) -> T: ...


class BadGeneric(GenericBase[str]):
    def __init__(self, callback: Callable[[bytes], bytes]):
        # This should generate an error because the specialized signature is incompatible.
        self.method = callback


class FinalBase:
    @final
    def method(self, value: int) -> int:
        return value


class BadFinal(FinalBase):
    def __init__(self, callback: IntCallback):
        # This should generate an error because the inherited method is final.
        self.method = callback
