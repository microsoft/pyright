# This sample tests bidirectional type inference in cases where the
# expected type is a union of multiple class instances.

from typing import Iterable, Sequence


def func1(points: tuple[float, float] | Iterable[tuple[float, float]]) -> None: ...


def test1(val: tuple[float, float]):
    func1(tuple((val, val)))


def func2(points: tuple[float, float] | Sequence[tuple[float, float]]) -> None: ...


def test2(val: tuple[float, float]):
    func2(tuple([val, val]))


def func3(points: tuple[float, float] | tuple[str, str]) -> None: ...


def test3(val: tuple[float, float]):
    func3(val)
