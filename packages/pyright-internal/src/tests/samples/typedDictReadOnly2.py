# This sample tests various uses of ReadOnly fields in TypedDict classes
# as specified in PEP 705.

# pyright: reportIncompatibleVariableOverride=true

from typing import (
    Generic,
    Literal,
    Mapping,
    Never,
    NotRequired,
    Required,
    TypeVar,
    TypedDict,
    Unpack,
)
from typing_extensions import ReadOnly  # pyright: ignore[reportMissingModuleSource]

_T = TypeVar("_T")


class TD1(TypedDict, Generic[_T]):
    a: ReadOnly[int]
    b: Required[str]
    c: Required[ReadOnly[list[str]]]
    d: ReadOnly[Required[dict[str, str]]]
    e: ReadOnly[_T]


class TD2(TD1[_T]):
    e: _T
    f: ReadOnly[str]


td1: TD1[float] = {"a": 3, "b": "", "c": [], "d": {}, "e": 0.0}

reveal_type(td1.get("a"), expected_text="int")
reveal_type(td1.get("b"), expected_text="str")
reveal_type(td1.get("c"), expected_text="list[str]")
reveal_type(td1.get("d"), expected_text="dict[str, str]")
reveal_type(td1.get("e"), expected_text="float")

td2: TD2[float] = {"a": 3, "b": "", "c": [], "d": {}, "e": 0.0, "f": ""}

x1: TD1[float] = td2


class TD3(TypedDict, total=True):
    a: str
    b: NotRequired[str]
    c: NotRequired[str]


class TD4(TypedDict, total=True):
    a: ReadOnly[str]
    b: NotRequired[str]
    c: NotRequired[str]


td3: TD3 = {"a": ""}
td4: TD4 = {"a": ""}

# This should generate an error because "a" is ReadOnly.
# It generates a second error because no overloads are found.
td4.update({"a", ""})

# This should generate an error because "a" is ReadOnly.
td4.update(a="")

# This should generate an error because "a" is ReadOnly.
# It generates a second error because no overloads are found.
td4.update([("a", "")])

td4.update({"b": ""})
td4.update({"b": "", "c": ""})
td4.update(b="")
td4.update(c="")
td4.update(c="", b="")
td4.update([("b", "")])
td4.update([("c", "")])
td4.update([("b", ""), ("c", "")])

td5 = td3 | td4

# This should generate an error.
td4["a"] = ""

# This should generate an error.
x3_0: TD3 = td4
x3_1: TD3 = td3
x4_0: TD4 = td3
x4_1: TD4 = td4


def func1(**kwargs: Unpack[TD4]):
    # This should generate an error.
    kwargs["a"] = ""


m1: Mapping[str, object] = td3
m2: Mapping[str, object] = td4


class TD5(TypedDict):
    a: ReadOnly[float | str]
    b: ReadOnly[int]


class TD6(TD5):
    a: int

    # This should generate an error because str is not
    # a subtype of int.
    b: ReadOnly[str]


class TD7(TD6):
    # This should generate an error because Literal[3] is
    # not the same type as int.
    a: Literal[3]


class TD8(TypedDict):
    a: ReadOnly[NotRequired[int]]


class TD9(TypedDict):
    a: NotRequired[int]


class TD10(TypedDict):
    a: int


td10: TD10 = {"a": 0}
n1: TD8 = td10

# This should generate an error because "a" is writable
# and required in TD10 but writable and not required in
# TD9, which means it can be deleted.
n2: TD9 = td10


class TD11(TypedDict):
    a: int


class TD12(TypedDict):
    a: ReadOnly[float]


class TD13(TypedDict):
    a: float


v1 = TD11(a=2)
v2: TD12 = v1

# This should generate an error because "a" is writable
# and is therefore invariant.
v3: TD13 = v1


class TD14(TypedDict):
    x: int


class TD15(TypedDict):
    x: int
    y: ReadOnly[NotRequired[str]]


td14: TD14 = {"x": 1}

# This should generate an error because 'str' is not
# compatible with 'object'.
td15: TD15 = td14


class TD16(TypedDict):
    x: int


class TD17(TypedDict):
    x: int
    y: ReadOnly[NotRequired[object]]


td16: TD16 = {"x": 1}
ted17: TD17 = td16


class TD18(TypedDict):
    x: NotRequired[ReadOnly[int]]
    y: int


td18_1: TD18 = {"x": 1, "y": 2}
td18_2: TD18 = {"x": 2, "y": 4}

# This should generate an error because "x" is read-only.
# It generates a second error because no overloads are found.
td18_1.update(td18_2)


class TD19(TypedDict):
    x: NotRequired[Never]
    y: ReadOnly[int]


def update_a(a: TD18, b: TD19) -> None:
    a.update(b)


class TD20(TypedDict):
    pass


td20 = TD20()
td20.update(TD20())


class TD_A1(TypedDict):
    x: int
    y: ReadOnly[int]


class TD_A2(TypedDict):
    x: float
    y: ReadOnly[float]


# This should generate an error for x but not y.
class TD_A(TD_A1, TD_A2): ...


class TD_B1(TypedDict):
    x: ReadOnly[NotRequired[int]]
    y: ReadOnly[Required[int]]


class TD_B2(TypedDict):
    x: ReadOnly[Required[int]]
    y: ReadOnly[NotRequired[int]]


# This should generate an error for x but not y.
class TD_B(TD_B1, TD_B2): ...
