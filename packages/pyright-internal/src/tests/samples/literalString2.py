# This tests the case where LiteralString is used as a bound for a
# type variable.

from typing import TypeVar, Generic
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    LiteralString,
)

L = TypeVar("L", bound=LiteralString)


class Foo(Generic[L]):
    def __init__(self, value: L) -> None:
        self.value = value


foo = Foo("hmm")
