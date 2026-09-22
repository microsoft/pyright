# This sample tests that a sequence pattern that doesn't narrow any of the
# entries of a tuple subclass (such as a NamedTuple) preserves the class.

from typing import NamedTuple


class A(NamedTuple):
    x: int
    y: int


class B(NamedTuple):
    x: int | str
    y: int


def func1(a: A) -> None:
    match a:
        case _, _:
            reveal_type(a, expected_text="A")
        case _:
            reveal_type(a, expected_text="Never")


def func2(a: A) -> None:
    match a:
        case x, y:
            reveal_type(a, expected_text="A")
            reveal_type(x, expected_text="int")
            reveal_type(y, expected_text="int")


def func3(b: B) -> None:
    match b:
        case str(), _:
            # The first entry was narrowed, so the subject becomes a tuple.
            reveal_type(b, expected_text="tuple[str, int]")
        case _:
            # Negative narrowing of the first entry also produces a tuple.
            reveal_type(b, expected_text="tuple[int, int]")


def func4(t: tuple[int, ...]) -> None:
    match t:
        case _, _:
            # A plain tuple is still narrowed to the matched length.
            reveal_type(t, expected_text="tuple[int, int]")

class Integers(tuple[int, ...]):
    pass


def consume_pair(value: tuple[int, int]) -> None:
    pass


def variable_length_subclass(value: Integers) -> None:
    match value:
        case [_, _]:
            reveal_type(value, expected_text="tuple[int, int]")
            consume_pair(value)


def empty_subclass(value: Integers) -> None:
    match value:
        case []:
            reveal_type(value, expected_text="tuple[()]")


class TaggedIntegers(tuple[str, *tuple[int, ...]]):
    pass


def variadic_subclass(value: TaggedIntegers) -> None:
    match value:
        case [_, _]:
            reveal_type(value, expected_text="tuple[str, int]")
