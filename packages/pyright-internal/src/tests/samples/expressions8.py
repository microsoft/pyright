# This sample verifies that binary expressions like "less than"
# work if the operands are constrained TypeVars.

from abc import abstractmethod
from typing import Protocol, TypeVar

_T = TypeVar("_T")


class ComparableTo(Protocol[_T]):
    @abstractmethod
    def __lt__(self, other: _T) -> bool:
        pass


def custom_compare(a: ComparableTo[_T], b: _T) -> bool:
    return a < b


custom_compare("first", "second")

custom_compare(3, 2)

# This should generate an error.
custom_compare(3, "hi")
