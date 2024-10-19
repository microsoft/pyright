# This sample tests the interaction between a traditional type alias
# and a PEP 695 type alias.

from typing import Annotated, TypeVar


T = TypeVar("T")

TA1 = Annotated[T, "metadata"]
TA2 = list[T]

type TA1_1 = TA1[int]
type TA1_2[T] = TA1[T]

type TA2_1 = TA2[int]
type TA2_2[T] = TA2[T]
