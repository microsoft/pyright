# This sample tests an overload that provides a signature for
# a *args parameter.


from typing import Iterable, Tuple, TypeVar, overload


_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2")


@overload
def func1(__iter1: Iterable[_T1]) -> Tuple[_T1]:
    ...


@overload
def func1(__iter1: Iterable[_T1], __iter2: Iterable[_T2]) -> Tuple[_T1, _T2]:
    ...


# This should generate an error because this overload overlaps
# with the first one and returns a different type.
@overload
def func1(*iterables: Iterable[_T1]) -> Tuple[_T1, ...]:
    ...


def func1(*iterables: Iterable[_T1]) -> Tuple[_T1, ...]:
    ...


def func2(x: Iterable[int]):
    v1 = func1(x)
    reveal_type(v1, expected_text="Tuple[int]")

    v2 = func1(x, x)
    reveal_type(v2, expected_text="Tuple[int, int]")

    y = [x, x, x, x]

    v3 = func1(*y)
    reveal_type(v3, expected_text="Tuple[int, ...]")

    z = (x, x)

    v4 = func1(*z)
    reveal_type(v4, expected_text="Tuple[int, int]")
