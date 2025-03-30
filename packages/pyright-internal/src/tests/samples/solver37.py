# This sample tests a complex TypeVar unification scenario.

from typing import Callable, Generic, TypeVar

A = TypeVar("A")
B = TypeVar("B")


class Gen(Generic[A]): ...


def func1(x: A) -> A: ...


def func2(x: Gen[A], y: A) -> Gen[Gen[A]]: ...


def func3(x: Gen[Gen[A]]) -> Gen[A]:
    return func4(x, func1, func2)


def func4(x: Gen[A], id_: Callable[[B], B], step: Callable[[A, B], Gen[A]]) -> A: ...
