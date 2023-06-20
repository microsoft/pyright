# This sample tests the case where two recursive type aliases
# with different definitions overlap.

from typing import Mapping, Optional, Sequence, Union

JsonArr1 = Sequence[Optional["JsonVal1"]]
JsonObj1 = Mapping[str, Optional["JsonVal1"]]
JsonVal1 = Union[bool, float, int, str, "JsonArr1", "JsonObj1"]

JsonArr2 = Sequence[Optional["JsonVal2"]]
JsonObj2 = Mapping[str, Optional["JsonVal2"]]
JsonVal2 = Union[bool, float, int, str, "JsonArr2", "JsonObj2"]


def func1(v: JsonVal1):
    x: JsonVal2 = v

    return x


def func2(v: Optional[JsonVal1]):
    # This should generate an error.
    x: JsonVal2 = v

    return x


def func3(v: Optional[JsonVal1]):
    # This should generate an error.
    x: Optional[JsonVal2] = v

    return x
