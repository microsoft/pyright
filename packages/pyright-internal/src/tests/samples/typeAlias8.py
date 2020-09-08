# This sample tests Pyright's handling of recursive type aliases.

from typing import List, TypeAlias, Union

# This should generate an error because the forward reference
# type needs to be in quotes.
GenericClass0 = List[Union[GenericClass0, int]]

# This should generate an error because the type alias directly
# refers to itself.
RecursiveUnion = Union["RecursiveUnion", int]

a1: RecursiveUnion = 3

# This should generate an error because the type alias refers
# to itself through a mutually-referential type alias.
MultualReference1 = Union["MultualReference2", int]
MultualReference2 = Union["MultualReference1", str]

# This should generate an error because the type alias refers
# to itself.
MutualReference3: TypeAlias = "MutualReference3"
