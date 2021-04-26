# This sample tests that a generic type alias can use
# a compatible bound TypeVar.

from typing import Generic, TypeVar

D = TypeVar("D", bool, int, float, object)
E = TypeVar("E", bool, int, float, object)


class Gen(Generic[D]):
    pass


GenAlias = Gen[E]
