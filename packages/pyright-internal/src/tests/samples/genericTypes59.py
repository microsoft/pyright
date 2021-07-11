# This sample tests the handling of a union that includes both
# T and a generic class parameterized by T. This case is indeterminate
# according to PEP 484, but pyright has code in place to find the
# "least complex" answer.

from typing import Generic, List, Literal, TypeVar, Union

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
    t_x: Literal["float"] = reveal_type(x)


def func3a(value: List[Union[str, List[float]]]):
    # This should generate an error
    func1a(value)


def func4a(value: List[Union[float, str, List[Union[float, str]]]]):
    x = func1a(value)
    t_x: Literal["float | str"] = reveal_type(x)


def func1b(value: List[Union[int, List[T1]]]) -> T1:
    ...


def func2b(value: List[Union[int, List[float]]]):
    x = func1b(value)
    t_x: Literal["float"] = reveal_type(x)


def func3b(value: List[Union[str, List[float]]]):
    # This should generate an error
    func1b(value)
