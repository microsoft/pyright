# This sample tests indexing of tuples with slice expressions.


from typing import TypeVarTuple


def func1(val1: tuple[int, str, None], val2: tuple[int, ...]):
    x1 = val1[:2]
    reveal_type(x1, expected_text="tuple[int, str]")

    x2 = val1[-3:2]
    reveal_type(x2, expected_text="tuple[int, str]")

    x3 = val1[1:]
    reveal_type(x3, expected_text="tuple[str, None]")

    x4 = val1[1:-1]
    reveal_type(x4, expected_text="tuple[str]")

    x5 = val1[:-2]
    reveal_type(x5, expected_text="tuple[int]")

    x6 = val1[0:100]
    reveal_type(x6, expected_text="tuple[int, str, None]")

    x7 = val2[:2]
    reveal_type(x7, expected_text="tuple[int, ...]")

    x8 = val1[1:3]
    reveal_type(x8, expected_text="tuple[str, None]")


def func2(val1: tuple[str, *tuple[int, ...], None]):
    x1 = val1[:2]
    reveal_type(x1, expected_text="tuple[str | int | None, ...]")

    x2 = val1[:1]
    reveal_type(x2, expected_text="tuple[str]")

    x3 = val1[1:]
    reveal_type(x3, expected_text="tuple[*tuple[int, ...], None]")

    x4 = val1[1:2]
    reveal_type(x4, expected_text="tuple[str | int | None, ...]")

    x5 = val1[1:-1]
    reveal_type(x5, expected_text="tuple[int, ...]")

    x6 = val1[:-1]
    reveal_type(x6, expected_text="tuple[str, *tuple[int, ...]]")

    x7 = val1[:]
    reveal_type(x7, expected_text="tuple[str, *tuple[int, ...], None]")

    x8 = val1[2:0]
    reveal_type(x8, expected_text="tuple[str | int | None, ...]")


Ts = TypeVarTuple("Ts")


def func3(val1: tuple[str, *Ts, None]):
    x1 = val1[:2]
    reveal_type(x1, expected_text="tuple[str | Union[*Ts@func3] | None, ...]")

    x2 = val1[:1]
    reveal_type(x2, expected_text="tuple[str]")

    x3 = val1[1:]
    reveal_type(x3, expected_text="tuple[*Ts@func3, None]")

    x4 = val1[1:2]
    reveal_type(x4, expected_text="tuple[str | Union[*Ts@func3] | None, ...]")

    x5 = val1[1:-1]
    reveal_type(x5, expected_text="tuple[*Ts@func3]")

    x6 = val1[:-1]
    reveal_type(x6, expected_text="tuple[str, *Ts@func3]")

    x7 = val1[:]
    reveal_type(x7, expected_text="tuple[str, *Ts@func3, None]")

    x8 = val1[2:0]
    reveal_type(x8, expected_text="tuple[str | Union[*Ts@func3] | None, ...]")


def func4(val1: tuple[str, int]):
    x1 = val1[2:]
    reveal_type(x1, expected_text="tuple[()]")

    x2 = val1[-4:]
    reveal_type(x2, expected_text="tuple[str, int]")

    x3 = val1[-4:-3]
    reveal_type(x3, expected_text="tuple[()]")

    x4 = val1[:-3]
    reveal_type(x4, expected_text="tuple[()]")
