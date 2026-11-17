# Optional nested literals retreat before structural unions from dynamic indexing.
# Constant selection, scalar alternatives and independent annotations stay precise.

from typing import Literal, assert_type


def int_row(value: tuple[int]) -> None:
    pass


def literal_row(value: tuple[Literal[0]] | tuple[Literal[1]]) -> None:
    pass


def literal_zero(value: Literal[0]) -> None:
    pass


def inferred(index: int) -> None:
    choices = ((0,), (1,))
    selected = choices[index]
    assert_type(selected, tuple[int])
    int_row(selected)
    literal_row(selected)  # This should generate an argument-type error.
    assert_type(choices[0], tuple[Literal[0]])
    assert_type(choices[-1], tuple[Literal[1]])
    assert_type(choices[:1], tuple[tuple[Literal[0]]])
    literal_zero(choices[0][0])
    literal_zero(choices[-1][0])  # This should generate an argument-type error.

    zero = 0
    assert_type(choices[zero], tuple[Literal[0]])

    value = choices[index][0]
    assert_type(value, int)
    if value == 0:
        assert_type(value, Literal[0])
        literal_zero(value)


def single_row(index: int) -> None:
    choices = ((0,),)
    assert_type(choices[index], tuple[Literal[0]])
    literal_zero(choices[index][0])


def scalar_alternatives(index: int) -> None:
    choices = ((0, 1, 2),)[0]
    value = choices[index]
    assert_type(value, Literal[0, 1, 2])
    literal_zero(value)  # This should generate an argument-type error.


def annotated(
    choices: tuple[tuple[Literal[0]], tuple[Literal[1]]], index: int
) -> None:
    selected = choices[index]
    assert_type(selected, tuple[Literal[0]] | tuple[Literal[1]])
    literal_row(selected)
    int_row(selected)
    literal_zero(selected[0])  # This should generate an argument-type error.


def annotated_local(index: int) -> None:
    choices: tuple[tuple[Literal[0]], tuple[Literal[1]]] = ((0,), (1,))
    selected = choices[index]
    assert_type(selected, tuple[Literal[0]] | tuple[Literal[1]])
    literal_row(selected)


def mixed(index: int) -> None:
    choices = ((0,), ("x",))
    selected = choices[index]
    assert_type(selected, tuple[int] | tuple[str])
    int_row(selected)  # This should generate an argument-type error.


class Index:
    def __index__(self) -> int:
        return 0


def index_protocol(index: Index) -> None:
    choices = ((0,), (1,))
    assert_type(choices[index], tuple[int])


def invalid_index() -> None:
    choices = ((0,), (1,))
    choices["bad"]  # This should generate call- and argument-type errors.
