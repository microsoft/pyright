# This sample tests a complex combination of TypeVarTuple,
# unpacking, bidirectional type inference, and recursive calls.

from dataclasses import dataclass
from typing import Generic, TypeVar, TypeVarTuple, Callable

X = TypeVar("X")
Y = TypeVar("Y")
Z = TypeVar("Z")
Xs = TypeVarTuple("Xs")
Ys = TypeVarTuple("Ys")


def nil() -> tuple[()]:
    return ()


def cons(
    f: Callable[[X], Y],
    g: Callable[[*Xs], tuple[*Ys]],
) -> Callable[[X, *Xs], tuple[Y, *Ys]]:
    def wrapped(x: X, *xs: *Xs) -> tuple[Y, *Ys]:
        y, ys = f(x), g(*xs)
        return y, *ys

    return wrapped


def star(f: Callable[[X], Y]) -> Callable[[*tuple[X, ...]], tuple[Y, ...]]:
    def wrapped(*xs: X):
        if not xs:
            return nil()
        return cons(f, star(f))(*xs)

    return wrapped


@dataclass(frozen=True)
class Tree(Generic[X, Y]):
    left: X
    right: Y


def lift(
    f: Callable[[*Xs], tuple[*Ys]],
) -> Callable[[Tree[Z, tuple[*Xs]]], Tree[Z, tuple[*Ys]]]: ...


def test(
    f: Callable[[X], Y],
) -> Callable[[Tree[Z, tuple[X, ...]]], Tree[Z, tuple[Y, ...]]]:
    return lift(star(f))


def parallel(
    f: Callable[[X], Y],
    g: Callable[[*Xs], tuple[*Ys]],
) -> Callable[[X, *Xs], tuple[Y, *Ys]]:
    def wrapped(a: X, *bs: *Xs):
        return f(a), *g(*bs)

    return wrapped


def identity(x: X) -> X:
    return x


def parallel_identity(*xs: *Xs) -> tuple[*Xs]:
    return xs


Shape = TypeVarTuple("Shape")
DType = TypeVar("DType")


class NDArray(Generic[*Shape, DType]): ...


def insert(values: NDArray[*Shape, DType]) -> NDArray[int, *Shape, DType]: ...


def prepend(values: NDArray[*Shape, DType]) -> NDArray[int, *Shape, DType]:
    return insert(values)
