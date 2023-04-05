from _typeshed import Incomplete
from collections.abc import Iterator
from typing_extensions import Self

from openpyxl.descriptors import Bool, DateTime, Float, Integer, Sequence, Strict, String
from openpyxl.descriptors.nested import NestedText

class NestedBoolText(Bool, NestedText): ...

class _TypedProperty(Strict):
    name: String
    value: Incomplete
    def __init__(self, name: str, value) -> None: ...
    def __eq__(self, other: _TypedProperty) -> bool: ...  # type: ignore[override]

class IntProperty(_TypedProperty):
    value: Integer

class FloatProperty(_TypedProperty):
    value: Float

class StringProperty(_TypedProperty):
    value: String

class DateTimeProperty(_TypedProperty):
    value: DateTime

class BoolProperty(_TypedProperty):
    value: Bool

class LinkProperty(_TypedProperty):
    value: String

CLASS_MAPPING: Incomplete
XML_MAPPING: Incomplete

class CustomPropertyList(Strict):
    props: Sequence
    def __init__(self) -> None: ...
    @classmethod
    def from_tree(cls, tree) -> Self: ...
    def append(self, prop) -> None: ...
    def to_tree(self): ...
    def __len__(self) -> int: ...
    @property
    def names(self) -> list[str]: ...
    def __getitem__(self, name): ...
    def __delitem__(self, name) -> None: ...
    def __iter__(self) -> Iterator[Incomplete]: ...
