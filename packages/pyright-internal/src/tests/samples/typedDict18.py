# This sample tests the handling of generic TypedDicts which are
# supported in Python 3.11 and newer.

from typing import Generic, Literal, TypeVar, TypedDict

_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2")


class TD1(TypedDict, Generic[_T1, _T2]):
    a: dict[_T1, _T2]
    b: _T1


v1_1: TD1[str, int] = {"a": {"x": 3}, "b": "y"}

# This should generate an error.
v1_2: TD1[str, str] = {"a": {"x": 3}, "b": "y"}


class TD2(TD1[_T1, int]):
    c: _T1


v2_1: TD2[int] = {"a": {3: 3}, "b": 1, "c": 5}


class TD3(TypedDict):
    a: int


class TD4(TD3, Generic[_T1]):
    b: _T1


v4: TD4[str] = {"a": 3, "b": ""}


def func1(x: TD1[_T1, _T2]) -> dict[_T1, _T2]:
    return x["a"]


v1_3 = func1({"a": {"x": 3}, "b": "y"})
reveal_type(v1_3, expected_text="dict[str, int]")


class TD5(TypedDict, Generic[_T1]):
    x: _T1
    y: _T1


def func2(a: TD5[Literal[1]]):
    ...


func2({"x": 1, "y": 1})

# This should generate an error because 2 doesn't match Literal[1].
func2({"x": 2, "y": 1})


def func3(a: TD5[_T1]) -> _T1:
    ...


reveal_type(func3({"x": 1, "y": 1}), expected_text="int")
reveal_type(func3({"x": "1", "y": 1}), expected_text="str | int")
