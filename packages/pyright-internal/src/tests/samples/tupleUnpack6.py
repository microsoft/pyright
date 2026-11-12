# This sample tests assignment of a tuple to a tuple type that contains
# an unpacked TypeVar whose upper bound is a tuple.

from typing import Any, Callable, Literal


class Box[S: tuple[int, ...]]:
    def __init__(self, s: S) -> None: ...


def func1[S: tuple[int, ...]](b: Box[tuple[*S, Literal[3]]]) -> Box[S]: ...


def func2[S: tuple[int, ...]](t: tuple[int, *S]) -> S: ...


def func3[S: tuple[int, ...]](t: tuple[*S, str]) -> S: ...


def func4[S: tuple[int, ...]](t: tuple[int, *S, str]) -> S: ...


def func5[S: tuple[int, ...]](b: Box[tuple[Literal[1], *S, Literal[3]]]) -> Box[S]: ...


def test1(
    b1: Box[tuple[Literal[2], Literal[2], Literal[3]]],
    b2: Box[tuple[Literal[3]]],
    b3: Box[tuple[Literal[1], Literal[2], Literal[2], Literal[3]]],
):
    reveal_type(func1(b1), expected_text="Box[tuple[Literal[2], Literal[2]]]")
    reveal_type(func1(b2), expected_text="Box[tuple[()]]")
    reveal_type(func5(b3), expected_text="Box[tuple[Literal[2], Literal[2]]]")


def test2(t1: tuple[int, int, bool], t2: tuple[int], t3: tuple[int, *tuple[int, ...]]):
    reveal_type(func2(t1), expected_text="tuple[int, bool]")
    reveal_type(func2(t2), expected_text="tuple[()]")
    reveal_type(func2(t3), expected_text="tuple[int, ...]")


def test3(t: tuple[int, int, str]):
    reveal_type(func3(t), expected_text="tuple[int, int]")


def test4(t: tuple[str, str]):
    # This should generate an error because str is not assignable to
    # the upper bound of S.
    func3(t)


def test5(t1: tuple[int, bool, bool, str], t2: tuple[int, str], t3: tuple[int, *tuple[int, ...], str]):
    reveal_type(func4(t1), expected_text="tuple[bool, bool]")
    reveal_type(func4(t2), expected_text="tuple[()]")
    reveal_type(func4(t3), expected_text="tuple[int, ...]")


def test6(t: tuple[int, int]):
    # This should generate an error because the last entry isn't a str.
    func4(t)


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


def test7(t: tuple[bool, int, int]):
    reveal_type(func10(t), expected_text="tuple[bool]")


def func11[U: tuple[object, ...]](t: tuple[str, *U]) -> U: ...


def test8[S: tuple[str, *tuple[str, ...]]](t: tuple[*S, int]):
    reveal_type(func11(t), expected_text="tuple[*tuple[str, ...], int]")


def test9[S: tuple[str, int]](t: tuple[*S, int]):
    reveal_type(func11(t), expected_text="tuple[int, int]")
    v: tuple[str, int, int] = t


def test10[S: tuple[str, int]](t: tuple[*S]):
    # This should generate an error because S has two entries.
    v: tuple[str] = t


def test11[T1: tuple[str], U1: tuple[int], T2: tuple[str, ...]](
    t1: tuple[*T1], u1: tuple[*U1], t2: tuple[*T1, int], u2: tuple[str, *U1], t3: tuple[*T2]
):
    reveal_type(t1 + u1, expected_text="tuple[str, int]")
    reveal_type(t2 + u2, expected_text="tuple[str, int, str, int]")
    reveal_type(t3 + u1, expected_text="tuple[*tuple[str, ...], int]")
    reveal_type(t3 + (1,), expected_text="tuple[*T2@test11, Literal[1]]")


def test12[S: tuple[int, str]](t: list[tuple[*S]]):
    # This should generate an error because list is invariant
    # and S may be narrower than its bound.
    v: list[tuple[int, str]] = t


def test13[S: tuple[int, str]](t: list[tuple[*S]]):
    v: list[tuple[*S]] = t


def func12[S: tuple[int, str]](t: list[tuple[*S]]) -> S: ...


def test14(t: list[tuple[bool, str]]):
    reveal_type(func12(t), expected_text="tuple[bool, str]")


def test15[S: tuple[()]](callback: Callable[[tuple[*S]], None], t: list[tuple[*S]]) -> tuple[int, *S]:
    callback(())
    v: list[tuple[*S]] = t
    return (1,)


def test16[S: tuple[int]](callback: Callable[[tuple[*S]], None]):
    # This should generate an error because S may be narrower than its bound.
    callback((1,))

    # This should generate an error because S has one entry.
    callback(())


def func13[*Ts](t: tuple[*Ts]) -> tuple[*Ts]: ...


def test17[T1: tuple[int, ...], T2: tuple[int, int], T3: tuple[()]](
    t1: tuple[int, *T1],
    t2: tuple[int, *T1, str],
    t3: tuple[bytes, *T2],
    t4: tuple[int, int, *T2, str],
    t5: tuple[bytes, *T3],
):
    reveal_type(func2(t1), expected_text="T1@test17")
    reveal_type(func4(t2), expected_text="T1@test17")
    reveal_type(func13(t3), expected_text="tuple[bytes, *T2@test17]")
    reveal_type(func4(t4), expected_text="tuple[int, *T2@test17]")
    reveal_type(func13(t5), expected_text="tuple[bytes, *T3@test17]")
    v1: tuple[bytes, *T2] = func13(t3)
    v2: tuple[bytes, *T3] = func13(t5)


def test18[S: tuple[int, ...]](t: tuple[Any, ...]):
    v1: tuple[*S, Literal[3]] = t
    v2: tuple[*S] = t


def test19[S: tuple[int, ...]](t: tuple[*tuple[Any, ...], int]):
    # This should generate an error.
    v: tuple[*S, str] = t


def func14[S: tuple[int, ...]](m: tuple[*S, int, int], v: tuple[*S, int]) -> tuple[*S, str]: ...


def test20(t: tuple[int, int, int]):
    reveal_type(func14(t, t), expected_text="tuple[int, str] | tuple[int, int, str]")


def test21(t: tuple[int, int, int]):
    # This should generate an error.
    v: tuple[object, str] = func14(t, t)


def func15[S: tuple[int, ...]](*args: *S) -> S: ...


def test22():
    reveal_type(func15, expected_text="(*args: *S@func15) -> S@func15")


def test23[S: tuple[int, ...]](c: Callable[[*S], S]):
    reveal_type(c, expected_text="(*S@test23) -> S@test23")


# This should generate an error.
def func16[S: tuple[int, ...]](t: tuple[*S, ...]) -> None: ...
