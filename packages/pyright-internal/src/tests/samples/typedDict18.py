# This sample tests the handling of generic TypedDicts which are
# supported in Python 3.11 and newer.

from typing import Generic, Literal, TypeVar, TypedDict, Unpack

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
v5: TD4[tuple[str]] = {"a": 3, "b": ("",)}


def func1(x: TD1[_T1, _T2]) -> dict[_T1, _T2]:
    return x["a"]


v1_3 = func1({"a": {"x": 3}, "b": "y"})
reveal_type(v1_3, expected_text="dict[str, int]")


class TD5(TypedDict, Generic[_T1]):
    x: _T1
    y: _T1


def func2(a: TD5[Literal[1]]): ...


func2({"x": 1, "y": 1})

# This should generate an error because 2 doesn't match Literal[1].
func2({"x": 2, "y": 1})


def func3(a: TD5[_T1]) -> _T1: ...


reveal_type(func3({"x": 1, "y": 1}), expected_text="int")
reveal_type(func3({"x": "1", "y": 1}), expected_text="str | int")


class TD6(TD5[Literal[1]]):
    z: str


def func4(a: TD6) -> Literal[1]: ...


func4({"x": 1, "y": 1, "z": "a"})
f2: TD6 = {"x": 1, "y": 1, "z": "a"}

reveal_type(func4({"x": 1, "y": 1, "z": "a"}))


class TD7(TD5[_T1], Generic[_T1]):
    z: str


def func5(a: TD7[Literal[1]]) -> Literal[1]:
    return a["x"]


func5({"x": 1, "y": 1, "z": "a"})
f3: TD7[Literal[1]] = {"x": 1, "y": 1, "z": "a"}

reveal_type(func5({"x": 1, "y": 1, "z": "a"}))


class TD8(TD7[Literal[1]]): ...


def func6(a: TD8) -> Literal[1]:
    return a["x"]


func6({"x": 1, "y": 1, "z": "a"})
f4: TD8 = {"x": 1, "y": 1, "z": "a"}

reveal_type(func6({"x": 1, "y": 1, "z": "a"}))


class TD9(TypedDict, Generic[_T1]):
    x: _T1


class ClassA(Generic[_T1]):
    def __init__(self, **attrs: Unpack[TD9[_T1]]) -> None: ...


f5 = ClassA[int](x=1)

# This should generate an error because 1 isn't a valid type.
f6 = ClassA[str](x=1)

f7 = ClassA(x=1)
reveal_type(f7, expected_text="ClassA[int]")


class TD10(TypedDict, Generic[_T1]):
    x: _T1


class TD11(TypedDict):
    y: int


class TD12(TD10[str], TD11): ...
