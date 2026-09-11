# This sample tests contextual type inference for constructors passed as
# callables when the iterable is read through a descriptor.

from collections.abc import Callable, Iterable, Iterator
from typing import Self


class Meta(type):
    meta_values = [1, 2, 3]

    @property
    def values(cls) -> list[int]:
        return [1, 2, 3]


class ClassA(metaclass=Meta):
    class_values = [1, 2, 3]

    def __init__(self, value: int) -> None:
        self.value = value

    @classmethod
    @property
    def property_values(cls) -> list[int]:
        return [1, 2, 3]

    @property
    def instance_values(self) -> list[int]:
        return [1, 2, 3]

    @classmethod
    def from_metaclass_property(cls) -> Iterator[Self]:
        values = cls.values
        return map(cls, values)

    @classmethod
    def from_class_property(cls) -> Iterator[Self]:
        values = cls.property_values
        return map(cls, values)

    @classmethod
    def from_metaclass_attribute(cls) -> Iterator[Self]:
        values = cls.meta_values
        return map(cls, values)

    @classmethod
    def from_class_attribute(cls) -> Iterator[Self]:
        values = cls.class_values
        return map(cls, values)

    @classmethod
    def from_annotated_local(cls) -> Iterator[Self]:
        values: list[int] = cls.values
        return map(cls, values)

    def from_instance_property(self) -> Iterator[Self]:
        values = self.instance_values
        return map(type(self), values)


class StringMeta(type):
    @property
    def values(cls) -> list[str]:
        return ["a", "b"]


class MatchingStringClass(metaclass=StringMeta):
    def __init__(self, value: str) -> None:
        self.value = value

    @classmethod
    def from_metaclass_property(cls) -> Iterator[Self]:
        values = cls.values
        return map(cls, values)


class CustomIterator[T]:
    def __init__(self, values: Iterable[T]) -> None:
        self._values = iter(values)

    def __iter__(self) -> Self:
        return self

    def __next__(self) -> T:
        return next(self._values)


def apply_constructor[T, R](func: Callable[[T], R], values: Iterable[T]) -> CustomIterator[R]:
    return CustomIterator(map(func, values))


class CustomIteratorClass(metaclass=Meta):
    def __init__(self, value: int) -> None:
        self.value = value

    @classmethod
    def from_metaclass_property(cls) -> Iterator[Self]:
        values = cls.values
        return apply_constructor(cls, values)


class WrongTypeClass(metaclass=Meta):
    def __init__(self, value: str) -> None:
        self.value = value

    @classmethod
    def from_metaclass_property(cls) -> Iterator[Self]:
        values = cls.values
        # This should generate an error because the constructor accepts str.
        return apply_constructor(cls, values)


class WrongArityClass(metaclass=Meta):
    def __init__(self, value: int, extra: int) -> None:
        self.value = value + extra

    @classmethod
    def from_metaclass_property(cls) -> Iterator[Self]:
        values = cls.values
        # This should generate an error because the constructor requires two arguments.
        return apply_constructor(cls, values)
