# This sample tests an overload that provides a signature for
# a *args parameter.


from typing import Iterable, Literal, Tuple, TypeVar, overload


_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2")


@overload
def func1(__iter1: Iterable[_T1]) -> Tuple[_T1]:
    ...


@overload
def func1(__iter1: Iterable[_T1], __iter2: Iterable[_T2]) -> Tuple[_T1, _T2]:
    ...


@overload
def func1(*iterables: Iterable[_T1]) -> Tuple[_T1, ...]:
    ...


def func1(*iterables: Iterable[_T1]) -> Tuple[_T1, ...]:
    ...


def func2(x: Iterable[int]):
    v1 = func1(x)
    t1: Literal["Tuple[int]"] = reveal_type(v1)

    v2 = func1(x, x)
    t2: Literal["Tuple[int, int]"] = reveal_type(v2)

    y = [x, x, x, x]

    v3 = func1(*y)
    t3: Literal["Tuple[int, ...]"] = reveal_type(v3)

    z = (x, x)

    v4 = func1(*z)
    t4: Literal["Tuple[int, int]"] = reveal_type(v4)
