# This sample tests Pyright's handling of recursive type aliases
# that are also generic.

from typing import List, TypeVar, Union

_T2 = TypeVar("_T2", str, int)

GenericTypeAlias1 = List[Union["GenericTypeAlias1", _T2]]

SpecializedTypeAlias1 = GenericTypeAlias1[str]

a1: SpecializedTypeAlias1 = ["hi", ["hi", "hi"]]

# This should generate an error because int doesn't match the
# constraint of the TypeVar _T2.
SpecializedClass2 = GenericTypeAlias1[float]

b1: GenericTypeAlias1[str] = ["hi", "bye", [""], [["hi"]]]

# This should generate an error.
b2: GenericTypeAlias1[str] = ["hi", [2.4]]

