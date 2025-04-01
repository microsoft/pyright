# This sample tests the case where a generic function is passed
# as an argument to another generic function multiple times.

from dataclasses import dataclass
from typing import (
    Any,
    Callable,
    Generic,
    Literal,
    ParamSpec,
    Protocol,
    TypeVar,
    TypeVarTuple,
    overload,
)

T = TypeVar("T")
A = TypeVar("A")
B = TypeVar("B")
C = TypeVar("C")
D = TypeVar("D")
X = TypeVar("X")
Y = TypeVar("Y")
Z = TypeVar("Z")
P = ParamSpec("P")
Ts = TypeVarTuple("Ts")


def identity(x: T) -> T:
    return x


def triple_1(
    f: Callable[[A], X], g: Callable[[B], Y], h: Callable[[C], Z]
) -> Callable[[A, B, C], tuple[X, Y, Z]]:
    def wrapped(a: A, b: B, c: C) -> tuple[X, Y, Z]:
        return f(a), g(b), h(c)

    return wrapped


def triple_2(
    f: tuple[Callable[[A], X], Callable[[B], Y], Callable[[C], Z]],
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


def func1(f: Callable[[A], B]) -> Callable[[Pair[A, X]], Pair[B, X]]: ...


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
def test_5(a: Callable[P, type[T]], *, b: Literal[0] = ...) -> type[list[type[T]]]: ...


@overload
def test_5(a: T, *args: int, b: Literal[False, None] = ...) -> type[list[T]]: ...


@overload
def test_5(a: T, *args: int, b: Literal[True] = ...) -> type[list[T]]: ...


def test_5(a: Any, *args: int, b: Any = ...) -> Any: ...


val3 = test_5(test_5, **{})
reveal_type(
    val3,
    expected_text="Unknown",
)

val4 = test_5(test_5, b=True)
reveal_type(
    val4,
    expected_text="type[list[Overload[(a: (**P(1)@test_5) -> type[T(1)@test_5], *, b: Literal[0] = ...) -> type[list[type[T(1)@test_5]]], (a: T(1)@test_5, *args: int, b: Literal[False] | None = ...) -> type[list[T(1)@test_5]], (a: T(1)@test_5, *args: int, b: Literal[True] = ...) -> type[list[T(1)@test_5]]]]]",
)


def test_6(g: Callable[[B], C]) -> Callable[[Callable[[A], B]], Callable[[A], C]]: ...


val5 = test_6(test_6)
reveal_type(
    val5,
    expected_text="((A@test_6) -> ((B(1)@test_6) -> C(1)@test_6)) -> ((A@test_6) -> ((((A(1)@test_6) -> B(1)@test_6)) -> ((A(1)@test_6) -> C(1)@test_6)))",
)


def test_7(
    g: Callable[[C], D],
) -> Callable[[Callable[[A], Callable[[B], C]]], Callable[[A], Callable[[B], D]]]:
    val6 = test_6(test_6)(test_6)(g)
    reveal_type(
        val6,
        expected_text="((A(1)@test_6) -> ((A(2)@test_6) -> C@test_7)) -> ((A(1)@test_6) -> ((A(2)@test_6) -> D@test_7))",
    )
    return val6


def test_8(fn: Callable[[*Ts], Callable[[A], B]]) -> Callable[[A, *Ts], B]: ...


def test_9(x: Callable[[bool], Callable[[int], Callable[[str], None]]]):
    test_8(test_8(x))


def test_10(func: Callable[[*Ts], Any], *args: *Ts) -> Any: ...


def func2() -> None: ...


test_10(test_10, func2)


def test_11(func: Callable[[*Ts], T], *args: *Ts) -> T:
    return func(*args)


def func3(num: int, /) -> int:
    return num


test_11(test_11, func3, 123)

# This will generate an error, but it should not crash or cause an infinite loop.
test_11(test_11, test_11, func3, 123)


class Proto1(Protocol):
    def __call__(self, a: T, b: T) -> T: ...


def func4(a: T, b: T) -> T:
    return a


def test_12(p: Proto1) -> Proto1:
    return p(func4, func4)


reveal_type(
    identity((identity, identity)),
    expected_text="tuple[(x: T(1)@identity) -> T(1)@identity, (x: T(2)@identity) -> T(2)@identity]",
)

reveal_type(
    identity([identity]),
    expected_text="list[(x: T(1)@identity) -> T(1)@identity]",
)
