# This sample tests the handling of generic TypedDicts which are
# supported in Python 3.11 and newer.

from typing import Generic, TypeVar, TypedDict

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


# The following does not yet work like it should, so
# it is commented out for now.

# def func1(x: TD1[_T1, _T2]) -> dict[_T1, _T2]:
#     return x["a"]

# v1_3 = func1({"a": {"x": 3}, "b": "y"})
# reveal_type(v1_3, expected_text="dict[str, int]")
