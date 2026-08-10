# This sample tests type narrowing for isinstance and issubclass when
# the class argument is passed as a type[T] variable or tuple of type[T].

# pyright: reportMissingModuleSource=false

from typing import final
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
