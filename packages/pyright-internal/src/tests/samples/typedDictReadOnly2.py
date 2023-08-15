# This sample tests various uses of ReadOnly fields in TypedDict classes
# as specified in PEP 705.

from typing import (
    Generic,
    Literal,
    Mapping,
    NotRequired,
    Required,
    TypeVar,
    TypedDict,
    Unpack,
)
from typing_extensions import ReadOnly

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


class TD4(TypedDict, total=True):
    a: ReadOnly[str]


td3: TD3 = {"a": ""}
td4: TD4 = {"a": ""}

reveal_type(td4.update, expected_text="(__m: Never, /) -> None")

# This should generate an error.
td4.update({"a", ""})

# This should generate an error.
td4.update({})

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
    a: NotRequired[ReadOnly[int]]


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
