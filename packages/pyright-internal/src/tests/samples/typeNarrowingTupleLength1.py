# This sample tests type narrowing of tuples based on len(x) test.

from typing import Callable, Literal, ParamSpec, TypeVar

P = ParamSpec("P")


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
    N = 0
    if len(val) == N:
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
    val: (
        tuple[int, ...]
        | tuple[str]
        | tuple[str, str, str]
        | tuple[int, *tuple[str, ...], str]
        | tuple[int, *tuple[float, ...]]
    ),
    length: Literal[2],
):
    if len(val) == length:
        reveal_type(
            val, expected_text="tuple[int, int] | tuple[int, str] | tuple[int, float]"
        )
    else:
        reveal_type(
            val,
            expected_text="tuple[int, ...] | tuple[str] | tuple[str, str, str] | tuple[int, str, *tuple[str, ...], str] | tuple[int, *tuple[float, ...]]",
        )


def func10(t: tuple[()] | tuple[int] | tuple[int, int] | tuple[int, int, int]):
    if len(t) >= 2:
        reveal_type(t, expected_text="tuple[int, int] | tuple[int, int, int]")
    else:
        reveal_type(t, expected_text="tuple[()] | tuple[int]")


def func11(t: tuple[()] | tuple[int] | tuple[int, int] | tuple[int, int, int]):
    if len(t) > 1:
        reveal_type(t, expected_text="tuple[int, int] | tuple[int, int, int]")
    else:
        reveal_type(t, expected_text="tuple[()] | tuple[int]")


def func12(t: tuple[()] | tuple[int] | tuple[int, int]):
    if len(t) >= 0:
        reveal_type(t, expected_text="tuple[()] | tuple[int] | tuple[int, int]")
    else:
        reveal_type(t, expected_text="Never")


def func20(t: tuple[int, ...]):
    if len(t) >= 2:
        reveal_type(t, expected_text="tuple[int, int, *tuple[int, ...]]")
    else:
        reveal_type(t, expected_text="tuple[()] | tuple[int]")


def func21(t: tuple[int, ...]):
    if len(t) > 0:
        reveal_type(t, expected_text="tuple[int, *tuple[int, ...]]")
    else:
        reveal_type(t, expected_text="tuple[()]")


def func22(t: tuple[str, *tuple[int, ...], str]):
    if len(t) < 3:
        reveal_type(t, expected_text="tuple[str, str]")
    else:
        reveal_type(t, expected_text="tuple[str, int, *tuple[int, ...], str]")


def func23(t: tuple[str, *tuple[int, ...], str]):
    if len(t) <= 3:
        reveal_type(t, expected_text="tuple[str, str] | tuple[str, int, str]")
    else:
        reveal_type(t, expected_text="tuple[str, int, int, *tuple[int, ...], str]")


def func24(t: tuple[str, *tuple[int, ...], str]):
    if len(t) <= 34:
        reveal_type(t, expected_text="tuple[str, *tuple[int, ...], str]")
    else:
        reveal_type(t, expected_text="tuple[str, *tuple[int, ...], str]")


def func25(t: tuple[str, *tuple[int, ...], str]):
    if len(t) < 2:
        reveal_type(t, expected_text="Never")
    else:
        reveal_type(t, expected_text="tuple[str, *tuple[int, ...], str]")


def func26(fn: Callable[P, None]):
    def inner(*args: P.args, **kwargs: P.kwargs):
        if len(args) >= 0:
            reveal_type(args, expected_text="P@func26.args")
        else:
            reveal_type(args, expected_text="P@func26.args")
        return fn(*args, **kwargs)

    return inner


def func27(t: tuple[int, ...]):
    if len(t) == 0 or len(t) >= 2:
        reveal_type(t, expected_text="tuple[()] | tuple[int, int, *tuple[int, ...]]")
    else:
        reveal_type(t, expected_text="tuple[int]")


def func28(t: tuple[int, *tuple[int, ...]]):
    if len(t) == 1 or len(t) >= 3:
        reveal_type(
            t, expected_text="tuple[int] | tuple[int, int, int, *tuple[int, ...]]"
        )
    else:
        reveal_type(t, expected_text="tuple[int, int]")
