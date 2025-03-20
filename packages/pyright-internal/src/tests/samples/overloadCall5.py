# This sample tests an overload that provides a signature for
# a *args parameter.


from typing import Any, Iterable, Tuple, TypeVar, overload

_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2")


# This should generate an error because this overload overlaps
# with the third one and returns a different type.
@overload
def func1(__iter1: Iterable[_T1]) -> Tuple[_T1]: ...


@overload
def func1(__iter1: Iterable[_T1], __iter2: Iterable[_T2]) -> Tuple[_T1, _T2]: ...


@overload
def func1(*iterables: Iterable[_T1]) -> float: ...


def func1(*iterables: Iterable[_T1 | _T2]) -> Tuple[_T1 | _T2, ...] | float: ...


def test1(x: Iterable[int]):
    v1 = func1(x)
    reveal_type(v1, expected_text="Tuple[int]")

    v2 = func1(x, x)
    reveal_type(v2, expected_text="Tuple[int, int]")

    y = [x, x, x, x]

    v3 = func1(*y)
    reveal_type(v3, expected_text="float")

    z = (x, x)

    v4 = func1(*z)
    reveal_type(v4, expected_text="Tuple[int, int]")


@overload
def func2() -> tuple[()]: ...


@overload
def func2(x: int, /) -> tuple[int]: ...


@overload
def func2(*x: int) -> tuple[int, ...]: ...


def func2(*x: int) -> tuple[int, ...]:
    return x


reveal_type(func2(), expected_text="tuple[()]")
reveal_type(func2(1), expected_text="tuple[int]")
reveal_type(func2(1, 2), expected_text="tuple[int, ...]")
reveal_type(func2(*[1, 2, 3]), expected_text="tuple[int, ...]")


@overload
def func3(x: int, /) -> str: ...


@overload
def func3(x: int, y: int, /, *args: int) -> int: ...


def func3(*args: int) -> int | str:
    return 1


def test3(v: list[int]) -> None:
    r = func3(*v)
    reveal_type(r, expected_text="int")


def test4(v: list[tuple[int, str]]):
    z1 = zip(*v)
    reveal_type(z1, expected_text="zip[tuple[Any, ...]]")

    z2 = zip(v[0])
    reveal_type(z2, expected_text="zip[tuple[int | str]]")

    z3 = zip(v[0], v[1])
    reveal_type(z3, expected_text="zip[tuple[int | str, int | str]]")


@overload
def func4() -> tuple[()]: ...
@overload
def func4[T](**kwargs: T) -> tuple[T, ...]: ...
def func4(**kwargs: Any) -> tuple[Any, ...]: ...


def test5():
    v1 = func4(**{"a": 1})
    reveal_type(v1, expected_text="tuple[int, ...]")
    v2 = func4()
    reveal_type(v2, expected_text="tuple[()]")
