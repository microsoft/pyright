# This sample tests type narrowing of tuples based on len(x) test.

from typing import TypeVar


def func1(val: tuple[int] | tuple[int, int] | tuple[str, str]):
    if len(val) == 1:
        reveal_type(val, expected_text="tuple[int]")
    else:
        reveal_type(val, expected_text="tuple[int, int] | tuple[str, str]")

    if len(val) != 2:
        reveal_type(val, expected_text="tuple[int]")
    else:
        reveal_type(val, expected_text="tuple[int, int] | tuple[str, str]")


def func2(val: tuple[int] | tuple[int, ...]):
    if len(val) == 1:
        reveal_type(val, expected_text="tuple[int]")
    else:
        reveal_type(val, expected_text="tuple[int, ...]")

    if len(val) != 2:
        reveal_type(val, expected_text="tuple[int] | tuple[int, ...]")
    else:
        reveal_type(val, expected_text="tuple[int, int]")


def func3(val: tuple[int] | tuple[()]):
    if len(val) == 0:
        reveal_type(val, expected_text="tuple[()]")
    else:
        reveal_type(val, expected_text="tuple[int]")


_T1 = TypeVar("_T1", bound=tuple[int])
_T2 = TypeVar("_T2", bound=tuple[str, str])


def func4(val: _T1 | _T2) -> _T1 | _T2:
    if len(val) == 1:
        reveal_type(val, expected_text="_T1@func4")
    else:
        reveal_type(val, expected_text="_T2@func4")

    return val


def func5(
    val: tuple[int, ...]
    | tuple[str]
    | tuple[str, str, str]
    | tuple[int, *tuple[str, ...], str]
    | tuple[int, *tuple[float, ...]]
):
    if len(val) == 2:
        reveal_type(
            val, expected_text="tuple[int, int] | tuple[int, str] | tuple[int, float]"
        )
    else:
        reveal_type(
            val,
            expected_text="tuple[int, ...] | tuple[str] | tuple[str, str, str] | tuple[int, *tuple[str, ...], str] | tuple[int, *tuple[float, ...]]",
        )
