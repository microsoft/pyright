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
