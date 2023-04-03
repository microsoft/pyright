# This sample tests the case where a generic function is passed
# as an argument to another generic function multiple times.

from typing import TypeVar, Callable

T = TypeVar("T")
A = TypeVar("A")
B = TypeVar("B")
C = TypeVar("C")
X = TypeVar("X")
Y = TypeVar("Y")
Z = TypeVar("Z")


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
        expected_text="(A@test_2, T(1)@identity, T(2)@identity) -> tuple[X@test_2, T(1)@identity, T(2)@identity]",
    )

    return val
