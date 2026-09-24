# This sample tests type narrowing for isinstance and issubclass when
# the class argument is passed as a type[T] variable or tuple of type[T].

# pyright: reportMissingModuleSource=false

from typing import Any, final
from typing_extensions import reveal_type


class A:
    pass


class B:
    pass


@final
class FinalClass:
    pass


def test_positive_narrowing(x: A | B, cls: type[A]):
    if isinstance(x, cls):
        reveal_type(x, expected_text="A")


def test_positive_tuple_param(x: A | B, types: tuple[type[A], type[B]]):
    if isinstance(x, types):
        reveal_type(x, expected_text="A | B")


def test_final_class_param(x: FinalClass | B, cls: type[FinalClass]):
    if isinstance(x, cls):
        reveal_type(x, expected_text="FinalClass")
    else:
        reveal_type(x, expected_text="B")


def test_non_final_negative(x: A | B, cls: type[A]):
    if not isinstance(x, cls):
        reveal_type(x, expected_text="A | B")


def test_issubclass(x: type[FinalClass] | type[B], cls: type[FinalClass]):
    if issubclass(x, cls):
        reveal_type(x, expected_text="type[FinalClass]")
    else:
        reveal_type(x, expected_text="type[B]")


def test_issubclass_non_final(x: type[A] | type[B], cls: type[A]):
    if not issubclass(x, cls):
        reveal_type(x, expected_text="type[A] | type[B]")


@final
class FinalClass2:
    pass


def test_final_union_filter(
    x: FinalClass | FinalClass2, cls: type[FinalClass] | type[FinalClass2]
):
    if not isinstance(x, cls):
        reveal_type(x, expected_text="FinalClass | FinalClass2")


def test_final_unbounded_tuple(x: FinalClass | B, types: tuple[type[FinalClass], ...]):
    if not isinstance(x, types):
        reveal_type(x, expected_text="FinalClass | B")


def test_final_unbounded_tuple_issubclass(
    x: type[FinalClass] | type[B], types: tuple[type[FinalClass], ...]
):
    if not issubclass(x, types):
        reveal_type(x, expected_text="type[FinalClass] | type[B]")


def test_final_bounded_tuple(x: FinalClass | FinalClass2 | B, types: tuple[type[FinalClass], type[FinalClass2]]):
    if isinstance(x, types):
        reveal_type(x, expected_text="FinalClass | FinalClass2")
    else:
        reveal_type(x, expected_text="B")


def test_type_any(x: A | B, cls: type[Any]):
    if isinstance(x, cls):
        reveal_type(x, expected_text="A | B")
    else:
        reveal_type(x, expected_text="A | B")
