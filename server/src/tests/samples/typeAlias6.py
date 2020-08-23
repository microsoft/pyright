# This sample tests the handling of recursive type aliases.

from typing import List, TypeVar, Union

MyTree = List[Union["MyTree", int]]

t1: MyTree = [1, 2, 3, [3, 4], [[3], 5]]

# This should generate an error because a str is not allowed.
t2: MyTree = [3, ""]

# This should generate an error because a str is not allowed.
t3: MyTree = [1, 2, 3, [3, 4], [3, 4, 5, [3, "4"]]]

_T = TypeVar("_T")
GenericUnion = Union[int, _T]

i1: GenericUnion[str] = "hi"
i1 = 3

i2: GenericUnion[float] = 3
# This should generate an error because str isn't compatible.
i2 = "hi"


_T2 = TypeVar("_T2", str)

# This should generate an error because the forward reference
# type needs to be in quotes.
GenericClass0 = List[Union[GenericClass0, _T2]]

GenericClass1 = List[Union["GenericClass1", _T2]]

GenericClass2 = GenericClass1[str]

# This should generate an error because int doesn't match the
# constraint of the TypeVar _T2.
GenericClass3 = GenericClass1[int]

b1: GenericClass1[str] = ["hi", "bye", [""], [["hi"]]]

# This should generate an error because the assigned type
# isn't a List[str].
b2: GenericClass1[str] = ["hi", [2]]

# This should generate an error because the type alias directly
# refers to itself.
RecursiveUnion = Union["RecursiveUnion", int]

a1: RecursiveUnion = 3

# This should generate an error because the type alias refers
# to itself through a mutually-referential type alias.
MutualReference1 = Union["MutualReference2", int]
MutualReference2 = Union["MutualReference1", str]
