# This sample tests unnecessary isinstance and issubclass diagnostics for
# class-object alternatives and potentially empty tuples of class objects.

from typing import final


@final
class A:
    pass


@final
class B:
    pass


def test_unbounded_tuple(x: A, cls: type[A], classes: tuple[type[A], ...]):
    isinstance(x, classes)
    issubclass(cls, classes)
    if not isinstance(x, classes):
        reveal_type(x, expected_text="A")
    if not issubclass(cls, classes):
        reveal_type(cls, expected_text="type[A]")


def test_union_filter(x: A, cls: type[A], other: type[A] | type[B]):
    isinstance(x, other)
    issubclass(cls, other)


def test_union_tuple_entry(x: A, cls: type[A], classes: tuple[type[A] | type[B]]):
    isinstance(x, classes)
    issubclass(cls, classes)


def test_bounded_tuple(x: A, cls: type[A], classes: tuple[type[A]]):
    # This should generate an error if reportUnnecessaryIsInstance is true.
    isinstance(x, classes)
    # This should generate an error if reportUnnecessaryIsInstance is true.
    issubclass(cls, classes)


def test_disjoint_optional_tuple(x: B, cls: type[B], classes: tuple[type[A], ...]):
    # This should generate an error if reportUnnecessaryIsInstance is true.
    isinstance(x, classes)
    # This should generate an error if reportUnnecessaryIsInstance is true.
    issubclass(cls, classes)


def test_invalid_none(x: A, cls: type[A]):
    # This should generate an error because None alone is not a class filter.
    isinstance(x, None)
    # This should generate an error because None alone is not a class filter.
    issubclass(cls, None)


class Meta(type):
    def __subclasscheck__(self, subclass: type) -> bool:
        return False

    def __instancecheck__(self, instance: object) -> bool:
        return False


@final
class C(metaclass=Meta):
    pass


def test_custom_subclasscheck(x: type[C], cls: type[C], classes: tuple[type[C]]):
    issubclass(x, cls)
    issubclass(x, C)
    issubclass(x, classes)
    if not issubclass(x, cls):
        reveal_type(x, expected_text="type[C]")


def test_custom_metaclass_isinstance(x: C, cls: type[C]):
    # This should generate an error if reportUnnecessaryIsInstance is true.
    isinstance(x, cls)


def test_custom_subclasscheck_fixed_filter(x: type[int], cls: type[C]):
    # This should generate an error if reportUnnecessaryIsInstance is true.
    issubclass(x, (int, cls))
