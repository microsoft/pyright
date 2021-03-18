# This sample tests situations where bidirectional type inference
# influences the type of a generic function call.

from typing import List, Literal, TypeVar

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
t_v4: Literal["str"] = reveal_type(v4)

v5 = func2("test")
t_v5: Literal["List[str]"] = reveal_type(v5)
