# This sample tests type narrowing for conditional
# statements of the form X is <class> or X is not <class>.

from typing import Any, TypeVar, final


@final
class A: ...


@final
class B: ...


class C: ...


def func1(x: type[A] | type[B] | None | int):
    if x is A:
        reveal_type(x, expected_text="type[A]")
    else:
        reveal_type(x, expected_text="type[B] | int | None")


def func2(x: type[A] | type[B] | None | int, y: type[A]):
    if x is not y:
        reveal_type(x, expected_text="type[B] | int | None")
    else:
        reveal_type(x, expected_text="type[A]")


def func3(x: type[A] | type[B] | Any):
    if x is A:
        reveal_type(x, expected_text="type[A]")
    else:
        reveal_type(x, expected_text="type[B] | Any")


def func4(x: type[A] | type[B] | type[C]):
    if x is C:
        reveal_type(x, expected_text="type[C]")
    else:
        reveal_type(x, expected_text="type[A] | type[B] | type[C]")


T = TypeVar("T")


def func5(x: type[A] | type[B] | type[T]) -> type[A] | type[B] | type[T]:
    if x is A:
        reveal_type(x, expected_text="type[A] | type[A]*")
    else:
        reveal_type(x, expected_text="type[B] | type[T@func5]")

    return x


def func6(x: type):
    if x is str:
        reveal_type(x, expected_text="type[str]")
    else:
        reveal_type(x, expected_text="type")


def func7(x: type[A | B]):
    if x is A:
        reveal_type(x, expected_text="type[A]")
    else:
        reveal_type(x, expected_text="type[B]")
