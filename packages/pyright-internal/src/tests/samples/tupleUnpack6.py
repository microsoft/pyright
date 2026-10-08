# This sample tests assignment of a tuple to a tuple type that contains
# an unpacked TypeVar whose upper bound is a tuple.

from typing import Literal


class Box[S: tuple[int, ...]]:
    def __init__(self, s: S) -> None: ...


def func1[S: tuple[int, ...]](b: Box[tuple[*S, Literal[3]]]) -> Box[S]: ...


def func2[S: tuple[int, ...]](t: tuple[int, *S]) -> S: ...


def func3[S: tuple[int, ...]](t: tuple[*S, str]) -> S: ...


def func4[S: tuple[int, ...]](t: tuple[int, *S, str]) -> S: ...


def func5[S: tuple[int, ...]](b: Box[tuple[Literal[1], *S, Literal[3]]]) -> Box[S]: ...


def test1(b: Box[tuple[Literal[2], Literal[2], Literal[3]]]):
    reveal_type(func1(b), expected_text="Box[tuple[Literal[2], Literal[2]]]")


def test2(b: Box[tuple[Literal[3]]]):
    reveal_type(func1(b), expected_text="Box[tuple[()]]")


def test3(t1: tuple[int, int, bool], t2: tuple[int], t3: tuple[int, *tuple[int, ...]]):
    reveal_type(func2(t1), expected_text="tuple[int, bool]")
    reveal_type(func2(t2), expected_text="tuple[()]")
    reveal_type(func2(t3), expected_text="tuple[int, ...]")


def test4(t1: tuple[int, int, str], t2: tuple[str, str]):
    reveal_type(func3(t1), expected_text="tuple[int, int]")

    # This should generate an error because str is not assignable to
    # the upper bound of S.
    func3(t2)


def test5(
    t1: tuple[int, bool, bool, str],
    t2: tuple[int, str],
    t3: tuple[int, *tuple[int, ...], str],
    t4: tuple[int, int],
):
    reveal_type(func4(t1), expected_text="tuple[bool, bool]")
    reveal_type(func4(t2), expected_text="tuple[()]")
    reveal_type(func4(t3), expected_text="tuple[int, ...]")

    # This should generate an error because the last entry isn't a str.
    func4(t4)


def test6(b: Box[tuple[Literal[1], Literal[2], Literal[2], Literal[3]]]):
    reveal_type(func5(b), expected_text="Box[tuple[Literal[2], Literal[2]]]")


def test7[T: tuple[int, ...]](t1: tuple[int, *T], t2: tuple[int, *T, str]):
    reveal_type(func2(t1), expected_text="T@test7")
    reveal_type(func4(t2), expected_text="T@test7")


# This should generate an error because a tuple can contain only one
# unpacked TypeVar, TypeVarTuple or unbounded tuple.
def func6[S: tuple[int, ...], T: tuple[int, ...]](t: tuple[*S, *T]) -> None: ...


# This should generate an error.
def func7[S: tuple[int, ...]](t: tuple[*S, *tuple[int, ...]]) -> None: ...


# This should generate an error.
def func8[*Ts, S: tuple[int, ...]](t: tuple[*Ts, *S]) -> None: ...


# This should generate an error.
def func9[S: tuple[int, ...]](t: tuple[*S, int, *S]) -> None: ...


def func10[S: tuple[int, ...]](t: tuple[*S, *tuple[int, int]]) -> S: ...


def test8(t: tuple[bool, int, int]):
    reveal_type(func10(t), expected_text="tuple[bool]")


def func11[U: tuple[object, ...]](t: tuple[str, *U]) -> U: ...


def test9[S: tuple[str, *tuple[str, ...]]](t: tuple[*S, int]):
    reveal_type(func11(t), expected_text="tuple[*tuple[str, ...], int]")


def test10[S: tuple[str, int]](t: tuple[*S, int]):
    reveal_type(func11(t), expected_text="tuple[int, int]")
    v: tuple[str, int, int] = t


def test11[S: tuple[str, int]](t: tuple[*S]):
    # This should generate an error because S has two entries.
    v: tuple[str] = t


def test12[T: tuple[str], U: tuple[int]](t1: tuple[*T], u1: tuple[*U], t2: tuple[*T, int], u2: tuple[str, *U]):
    reveal_type(t1 + u1, expected_text="tuple[str, int]")
    reveal_type(t2 + u2, expected_text="tuple[str, int, str, int]")


def test13[T: tuple[str, ...], U: tuple[int]](t: tuple[*T], u: tuple[*U]):
    reveal_type(t + u, expected_text="tuple[*tuple[str, ...], int]")
    reveal_type(t + (1,), expected_text="tuple[*T@test13, Literal[1]]")


def test14[S: tuple[int, str]](t: list[tuple[*S]]):
    # This should generate an error because list is invariant
    # and S may be narrower than its bound.
    v1: list[tuple[int, str]] = t
    v2: list[tuple[*S]] = t


def func15[S: tuple[int, str]](t: list[tuple[*S]]) -> S: ...


def test15(t: list[tuple[bool, str]]):
    reveal_type(func15(t), expected_text="tuple[bool, str]")
