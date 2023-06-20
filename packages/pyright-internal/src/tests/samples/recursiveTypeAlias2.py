# This sample tests Pyright's handling of recursive type aliases
# that are also generic.

from typing import TypeVar, Union

_T1 = TypeVar("_T1", str, int)
_T2 = TypeVar("_T2")

GenericTypeAlias1 = list[Union["GenericTypeAlias1[_T1]", _T1]]

SpecializedTypeAlias1 = GenericTypeAlias1[str]

a1: SpecializedTypeAlias1 = ["hi", ["hi", "hi"]]

# This should generate an error because int doesn't match the
# constraint of the TypeVar _T1.
SpecializedClass2 = GenericTypeAlias1[float]

b1: GenericTypeAlias1[str] = ["hi", "bye", [""], [["hi"]]]

# This should generate an error.
b2: GenericTypeAlias1[str] = ["hi", [2.4]]


GenericTypeAlias2 = list[Union["GenericTypeAlias2[_T1, _T2]", _T1, _T2]]

c2: GenericTypeAlias2[str, int] = [[3, ["hi"]], "hi"]

c3: GenericTypeAlias2[str, float] = [[3, ["hi", 3.4, [3.4]]], "hi"]

# This should generate an error because a float is a type mismatch.
c4: GenericTypeAlias2[str, int] = [[3, ["hi", 3, [3.4]]], "hi"]
