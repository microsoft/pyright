# This sample tests type narrowing for isinstance and issubclass when
# the class argument is passed as a type[T] variable or tuple of type[T].

# pyright: reportMissingModuleSource=false

from typing_extensions import reveal_type


class A:
    pass


class B:
    pass


class C:
    pass


def test_tuple_param(x: A | B | C, types: tuple[type[A], type[B]]):
    if isinstance(x, types):
        reveal_type(x, expected_text="A | B")
    else:
        reveal_type(x, expected_text="C")


def test_tuple_annotated_local(x: A | B | C):
    types: tuple[type[A], type[B]] = (A, B)
    if isinstance(x, types):
        reveal_type(x, expected_text="A | B")
    else:
        reveal_type(x, expected_text="C")


def test_single_class_param(x: A | B, cls: type[A]):
    if isinstance(x, cls):
        reveal_type(x, expected_text="A")
    else:
        reveal_type(x, expected_text="B")


def test_issubclass_param(sub_cls: type[A] | type[B], cls: type[A]):
    if issubclass(sub_cls, cls):
        reveal_type(sub_cls, expected_text="type[A]")
    else:
        reveal_type(sub_cls, expected_text="type[B]")
