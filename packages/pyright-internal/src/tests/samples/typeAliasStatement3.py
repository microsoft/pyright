# This sample tests the error case where traditional type variables
# are used in a new-style type alias statement introduced in PEP 695.

from typing import TypeVar


V = TypeVar("V")

# This should generate an error because it combines old and
# new type variables.
type TA1[K] = dict[K, V]


T1 = TypeVar("T1")

# This should generate an error because it uses old type
# variables in a type alias statement.
type TA2 = list[T1]
