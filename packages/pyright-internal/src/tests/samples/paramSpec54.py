# This sample tests a function that uses a Concatenate with a callback
# that has a *args parameter.

from typing import Callable, Concatenate, reveal_type


def func1[T, **P, R](fn: Callable[Concatenate[T, P], R], val: T) -> Callable[P, R]: ...


def test1(*args: str) -> None: ...


reveal_type(func1(test1, ""), expected_text="(*args: str) -> None")
reveal_type(func1(func1(test1, ""), ""), expected_text="(*args: str) -> None")


def test2(p1: int, *args: str) -> None: ...


reveal_type(func1(test2, 0), expected_text="(*args: str) -> None")
reveal_type(func1(func1(test2, 0), ""), expected_text="(*args: str) -> None")
reveal_type(func1(func1(func1(test2, 0), ""), ""), expected_text="(*args: str) -> None")


def func2[T1, T2, **P, R](
    fn: Callable[Concatenate[T1, T2, P], R], val1: T1, val2: T2
) -> Callable[P, R]: ...


reveal_type(func2(test1, "", ""), expected_text="(*args: str) -> None")
reveal_type(func2(func2(test1, "", ""), "", ""), expected_text="(*args: str) -> None")
