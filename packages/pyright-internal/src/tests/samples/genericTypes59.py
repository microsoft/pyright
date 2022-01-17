# This sample tests the handling of a union that includes both
# T and a generic class parameterized by T. This case is indeterminate
# according to PEP 484, but pyright has code in place to find the
# "least complex" answer.

from typing import Any, Generic, List, TypeVar, Union

T1 = TypeVar("T1")


class Wrapper(Generic[T1]):
    ...


def ensure_wrapped(item: Union[T1, Wrapper[T1]]) -> Wrapper[T1]:
    ...


def some_func(x: Wrapper[T1]) -> Wrapper[T1]:
    return ensure_wrapped(x)


def func1a(value: List[Union[T1, List[T1]]]) -> T1:
    ...


def func2a(value: List[Union[float, List[float]]]):
    x = func1a(value)
    reveal_type(x, expected_text="float")


def func3a(value: List[Union[str, List[float]]]):
    # This should generate an error
    func1a(value)


def func4a(value: List[Union[float, str, List[Union[float, str]]]]):
    x = func1a(value)
    reveal_type(x, expected_text="float | str")


def func1b(value: List[Union[int, List[T1]]]) -> T1:
    ...


def func2b(value: List[Union[int, List[float]]]):
    x = func1b(value)
    reveal_type(x, expected_text="float")


def func3b(value: List[Union[str, List[float]]]):
    # This should generate an error
    func1b(value)


def ensure_list(value: Union[T1, List[T1]]) -> List[T1]:
    ...


def func4(
    v1: list, v2: List[Any], v3: List[None], v4: Any, v5: int, v6: T1, v7: List[T1]
) -> T1:
    reveal_type(ensure_list(v1), expected_text="List[Unknown]")
    reveal_type(ensure_list(v2), expected_text="List[Any]")
    reveal_type(ensure_list(v3), expected_text="List[None]")
    reveal_type(ensure_list(v4), expected_text="List[Any]")
    reveal_type(ensure_list(v5), expected_text="List[int]")
    reveal_type(ensure_list(v6), expected_text="List[T1@func4]")
    reveal_type(ensure_list(v7), expected_text="List[T1@func4]")

    return v6
