# This sample tests situations where bidirectional type inference
# influences the type of a generic function call.

from typing import Callable, Iterable, List, Literal, TypeVar

_T = TypeVar("_T")


def func1(arg: _T) -> _T:
    return arg


v1: Literal["test"] = func1("test")


x: List[Literal["test"]] = ["test"]
v2: List[Literal["test"]] = func1(x)


def func2(arg: _T) -> List[_T]:
    return [arg]


v3: List[Literal["test"]] = func2("test")

v4 = func1("test")
reveal_type(v4, expected_text="str")

v5 = func2("test")
reveal_type(v5, expected_text="List[str]")


def reduce(function: Callable[[_T, _T], _T], sequence: Iterable[_T]) -> _T: ...


dicts = [{"a": "b"}, {"c": "d"}]
v6 = reduce(lambda x, y: x | y, dicts)
reveal_type(v6, expected_text="dict[str, str]")

v7 = reduce(lambda x, y: {**x, **y}, dicts)
reveal_type(v7, expected_text="dict[str, str]")


def func3(func: Callable[[_T], bool], b: dict[_T, int]) -> _T:
    return next(iter(b.keys()))


def func4(func: Callable[[_T], bool]) -> _T:
    return func3(func, {})
