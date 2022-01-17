# This sample tests type narrowing of tuples based on len(x) test.

from typing import Tuple, TypeVar, Union


def func1(val: Union[Tuple[int], Tuple[int, int], Tuple[str, str]]):
    if len(val) == 1:
        reveal_type(val, expected_text="Tuple[int]")
    else:
        reveal_type(val, expected_text="Tuple[int, int] | Tuple[str, str]")

    if len(val) != 2:
        reveal_type(val, expected_text="Tuple[int]")
    else:
        reveal_type(val, expected_text="Tuple[int, int] | Tuple[str, str]")


def func2(val: Union[Tuple[int], Tuple[int, ...]]):
    if len(val) == 1:
        reveal_type(val, expected_text="Tuple[int] | Tuple[int, ...]")
    else:
        reveal_type(val, expected_text="Tuple[int, ...]")

    if len(val) != 2:
        reveal_type(val, expected_text="Tuple[int] | Tuple[int, ...]")
    else:
        reveal_type(val, expected_text="Tuple[int, ...]")


def func3(val: Union[Tuple[int], Tuple[()]]):
    if len(val) == 0:
        reveal_type(val, expected_text="Tuple[()]")
    else:
        reveal_type(val, expected_text="Tuple[int]")


_T1 = TypeVar("_T1", bound=Tuple[int])
_T2 = TypeVar("_T2", bound=Tuple[str, str])


def func4(val: Union[_T1, _T2]) -> Union[_T1, _T2]:
    if len(val) == 1:
        reveal_type(val, expected_text="_T1@func4")
    else:
        reveal_type(val, expected_text="_T2@func4")

    return val
