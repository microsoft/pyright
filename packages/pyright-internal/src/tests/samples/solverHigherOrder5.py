# This sample tests the case where a generic function is passed
# as an argument to another generic function multiple times.

from dataclasses import dataclass
from typing import Any, Generic, Literal, ParamSpec, TypeVar, Callable, overload

T = TypeVar("T")
A = TypeVar("A")
B = TypeVar("B")
C = TypeVar("C")
D = TypeVar("D")
X = TypeVar("X")
Y = TypeVar("Y")
Z = TypeVar("Z")
P = ParamSpec("P")


def identity(x: T) -> T:
    return x


def triple_1(
    f: Callable[[A], X], g: Callable[[B], Y], h: Callable[[C], Z]
) -> Callable[[A, B, C], tuple[X, Y, Z]]:
    def wrapped(a: A, b: B, c: C) -> tuple[X, Y, Z]:
        return f(a), g(b), h(c)

    return wrapped


def triple_2(
    f: tuple[Callable[[A], X], Callable[[B], Y], Callable[[C], Z]]
) -> Callable[[A, B, C], tuple[X, Y, Z]]:
    def wrapped(a: A, b: B, c: C) -> tuple[X, Y, Z]:
        return f[0](a), f[1](b), f[2](c)

    return wrapped


def test_1(f: Callable[[A], X]) -> Callable[[A, B, C], tuple[X, B, C]]:
    val = triple_1(f, identity, identity)

    reveal_type(
        val,
        expected_text="(A@test_1, T@identity, T(1)@identity) -> tuple[X@test_1, T@identity, T(1)@identity]",
    )

    return val


def test_2(f: Callable[[A], X]) -> Callable[[A, B, C], tuple[X, B, C]]:
    val = triple_2((f, identity, identity))

    reveal_type(
        val,
        expected_text="(A@test_2, T@identity, T(1)@identity) -> tuple[X@test_2, T@identity, T(1)@identity]",
    )

    return val


class ClassA:
    def identity(self, x: T) -> T:
        return x

    def test_1(self, f: Callable[[A], X]) -> Callable[[A, B, C], tuple[X, B, C]]:
        val = triple_1(f, self.identity, self.identity)

        reveal_type(
            val,
            expected_text="(A@test_1, T@identity, T(1)@identity) -> tuple[X@test_1, T@identity, T(1)@identity]",
        )

        return val

    def test_2(self, f: Callable[[A], X]) -> Callable[[A, B, C], tuple[X, B, C]]:
        val = triple_2((f, self.identity, self.identity))

        reveal_type(
            val,
            expected_text="(A@test_2, T@identity, T(1)@identity) -> tuple[X@test_2, T@identity, T(1)@identity]",
        )

        return val


@dataclass(frozen=True)
class Pair(Generic[A, B]):
    left: A
    right: B


def func1(f: Callable[[A], B]) -> Callable[[Pair[A, X]], Pair[B, X]]:
    ...


def test_3(pair: Pair[Pair[A, B], C]) -> Pair[Pair[A, B], C]:
    val1 = func1(func1(identity))
    reveal_type(
        val1,
        expected_text="(Pair[Pair[T@identity, X(1)@func1], X@func1]) -> Pair[Pair[T@identity, X(1)@func1], X@func1]",
    )
    val2 = val1(pair)
    reveal_type(val2, expected_text="Pair[Pair[A@test_3, B@test_3], C@test_3]")
    return val2


def test_4(pair: Pair[Pair[Pair[A, B], C], D]) -> Pair[Pair[Pair[A, B], C], D]:
    val1 = func1(func1(func1(identity)))
    reveal_type(
        val1,
        expected_text="(Pair[Pair[Pair[T@identity, X(2)@func1], X(1)@func1], X@func1]) -> Pair[Pair[Pair[T@identity, X(2)@func1], X(1)@func1], X@func1]",
    )
    val2 = val1(pair)
    return val2


@overload
def test_5(
    a: Callable[P, type[T]], *, b: Literal[False, None] = ...
) -> type[list[type[T]]]:
    ...


@overload
def test_5(a: T, *args: int, b: Literal[False, None] = ...) -> type[list[T]]:
    ...


@overload
def test_5(a: T, *args: int, b: Literal[True] = ...) -> type[list[T]]:
    ...


def test_5(a: Any, *args: int, b: Any = ...) -> Any:
    ...


val3 = test_5(test_5, **{})
reveal_type(
    val3,
    expected_text="Unknown",
)

val4 = test_5(test_5, b=True)
reveal_type(
    val4,
    expected_text="type[list[Overload[(a: (**P(1)@test_5) -> type[T(1)@test_5], *, b: Literal[False] | None = ...) -> type[list[type[T(1)@test_5]]], (a: T(1)@test_5, *args: int, b: Literal[False] | None = ...) -> type[list[T(1)@test_5]], (a: T(1)@test_5, *args: int, b: Literal[True] = ...) -> type[list[T(1)@test_5]], (a: Any, *args: int, b: Any = ...) -> Any]]]",
)
