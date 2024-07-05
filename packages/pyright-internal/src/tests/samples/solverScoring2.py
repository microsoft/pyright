# This sample tests the handling of a union that includes both
# T and a generic class parameterized by T. This case is indeterminate
# according to PEP 484, but pyright has code in place to find the
# "least complex" answer.

from typing import Any, Generic, TypeVar, Union

T1 = TypeVar("T1")


class Wrapper(Generic[T1]): ...


def ensure_wrapped(item: Union[T1, Wrapper[T1]]) -> Wrapper[T1]: ...


def some_func(x: Wrapper[T1]) -> Wrapper[T1]:
    return ensure_wrapped(x)


def func1a(value: list[Union[T1, list[T1]]]) -> T1: ...


def func2a(value: list[Union[float, list[float]]]):
    x = func1a(value)
    reveal_type(x, expected_text="float")


def func3a(value: list[Union[str, list[float]]]):
    # This should generate an error
    func1a(value)


def func4a(value: list[Union[float, str, list[Union[float, str]]]]):
    x = func1a(value)
    reveal_type(x, expected_text="float | str")


def func1b(value: list[Union[int, list[T1]]]) -> T1: ...


def func2b(value: list[Union[int, list[float]]]):
    x = func1b(value)
    reveal_type(x, expected_text="float")


def func3b(value: list[Union[str, list[float]]]):
    # This should generate an error
    func1b(value)


def ensure_list(value: Union[T1, list[T1]]) -> list[T1]: ...


def func4(
    v1: list, v2: list[Any], v3: list[None], v4: Any, v5: int, v6: T1, v7: list[T1]
) -> T1:
    reveal_type(ensure_list(v1), expected_text="list[Unknown]")
    reveal_type(ensure_list(v2), expected_text="list[Any]")
    reveal_type(ensure_list(v3), expected_text="list[None]")
    reveal_type(ensure_list(v4), expected_text="list[Any]")
    reveal_type(ensure_list(v5), expected_text="list[int]")
    reveal_type(ensure_list(v6), expected_text="list[T1@func4]")
    reveal_type(ensure_list(v7), expected_text="list[T1@func4]")

    return v6
