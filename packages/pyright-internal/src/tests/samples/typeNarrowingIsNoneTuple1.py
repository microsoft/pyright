# This sample tests the type narrowing case for unions of tuples
# where one or more of the entries is tested against type None.

from typing import TypeVar, Tuple, Union

_T1 = TypeVar("_T1")


def func1(a: Union[Tuple[_T1, None], Tuple[None, str]]) -> Tuple[_T1, None]:
    if a[1] is None:
        reveal_type(a, expected_text="Tuple[_T1@func1, None]")
        return a
    else:
        reveal_type(a, expected_text="Tuple[None, str]")
        raise ValueError()


_T2 = TypeVar("_T2", bound=Union[None, int])


def func2(a: Union[Tuple[_T2, None], Tuple[None, str]]):
    if a[0] is None:
        reveal_type(a, expected_text="Tuple[_T2@func2, None] | Tuple[None, str]")
    else:
        reveal_type(a, expected_text="Tuple[_T2@func2, None]")


_T3 = TypeVar("_T3", None, int)


def func3(a: Union[Tuple[_T3, None], Tuple[None, str]]):
    if a[0] is None:
        reveal_type(a, expected_text="Tuple[_T3@func3, None] | Tuple[None, str]")
    else:
        reveal_type(a, expected_text="Tuple[_T3@func3, None]")


def func4(a: Union[Tuple[Union[int, None]], Tuple[None, str]]):
    if a[0] is None:
        reveal_type(a, expected_text="Tuple[int | None] | Tuple[None, str]")
    else:
        reveal_type(a, expected_text="Tuple[int | None]")
