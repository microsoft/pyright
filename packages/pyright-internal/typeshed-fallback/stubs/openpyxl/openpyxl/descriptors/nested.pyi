from _typeshed import Incomplete

from openpyxl.descriptors import Strict
from openpyxl.descriptors.base import Bool, Convertible, Descriptor, Float, Integer, MinMax, NoneSet, Set, String
from openpyxl.descriptors.serialisable import Serialisable

# NOTE: # type: ignore[misc]: Class does not reimplement the relevant methods, so runtime also has incompatible supertypes

class Nested(Descriptor[Incomplete]):
    nested: bool
    attribute: str
    def __set__(self, instance: Serialisable | Strict, value) -> None: ...
    def from_tree(self, node): ...
    def to_tree(
        self, tagname: Incomplete | None = None, value: Incomplete | None = None, namespace: Incomplete | None = None
    ): ...

class NestedValue(Nested, Convertible[Incomplete, Incomplete]): ...  # type: ignore[misc]

class NestedText(NestedValue):
    def from_tree(self, node): ...
    def to_tree(
        self, tagname: Incomplete | None = None, value: Incomplete | None = None, namespace: Incomplete | None = None
    ): ...

class NestedFloat(NestedValue, Float[Incomplete]): ...  # type: ignore[misc]
class NestedInteger(NestedValue, Integer[Incomplete]): ...  # type: ignore[misc]
class NestedString(NestedValue, String[Incomplete]): ...  # type: ignore[misc]

class NestedBool(NestedValue, Bool[Incomplete]):  # type: ignore[misc]
    def from_tree(self, node): ...

class NestedNoneSet(Nested, NoneSet[Incomplete]): ...
class NestedSet(Nested, Set[Incomplete]): ...
class NestedMinMax(Nested, MinMax[Incomplete, Incomplete]): ...  # type: ignore[misc]

class EmptyTag(Nested, Bool[Incomplete]):  # type: ignore[misc]
    def from_tree(self, node): ...
    def to_tree(
        self, tagname: Incomplete | None = None, value: Incomplete | None = None, namespace: Incomplete | None = None
    ): ...
