# This sample tests constraint solving in a situation
# where the type has a type argument that is
# a union of types that are subclasses of each other.

from typing import Iterable, Iterator, Literal, TypeVar

_T = TypeVar("_T")


def filter(__function: None, __iterable: Iterable[_T | None]) -> Iterator[_T]: ...


# In this case, bool is a subclass of int, so the TypeVar
# matching for _T should evaluate to Iterator[int].
list_of_bools_and_ints: list[Literal[False] | int] = []
generator_of_ints = filter(None, list_of_bools_and_ints)

a: int = next(generator_of_ints)

# This should generate an error.
b: bool = next(generator_of_ints)
