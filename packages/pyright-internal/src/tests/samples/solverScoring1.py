# This sample tests the type checker's "type var scoring" mechanism
# whereby it attempts to solve type variables with the simplest
# possible solution.

from typing import Callable, TypeVar

T = TypeVar("T")


def func1(obj_type: type[T], obj: list[T] | T) -> list[T]:
    return []


def func2(obj_type: type[T], obj: T | list[T]) -> list[T]:
    return []


def func3(input1: list[str]):
    val1 = func1(str, input1)
    reveal_type(val1, expected_text="list[str]")

    val2 = func2(str, input1)
    reveal_type(val2, expected_text="list[str]")


def func4(
    func: Callable[[], T] | Callable[[T], None] | list[T] | dict[str, T] | T,
) -> T: ...


def func5(func: Callable[[], T]) -> T: ...


def func6(val: str) -> None: ...


def func7() -> str: ...


reveal_type(func4([""]), expected_text="str")
reveal_type(func4({"": 1}), expected_text="int")
reveal_type(func4(func6), expected_text="str")
reveal_type(func4(func7), expected_text="str")
reveal_type(func4(str), expected_text="str")
reveal_type(func5(str), expected_text="str")
