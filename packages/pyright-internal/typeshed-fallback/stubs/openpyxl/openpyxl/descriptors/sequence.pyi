from _typeshed import Incomplete, Unused
from collections.abc import Generator
from typing_extensions import Self

from openpyxl.descriptors import Strict
from openpyxl.descriptors.serialisable import Serialisable

from .base import Alias, Descriptor

class Sequence(Descriptor[Incomplete]):
    expected_type: type[Incomplete]
    seq_types: Incomplete
    idx_base: int
    unique: bool
    def __set__(self, instance: Serialisable | Strict, seq) -> None: ...
    def to_tree(self, tagname, obj, namespace: Incomplete | None = None) -> Generator[Incomplete, None, None]: ...

class ValueSequence(Sequence):
    attribute: str
    def to_tree(self, tagname, obj, namespace: Incomplete | None = None) -> Generator[Incomplete, None, None]: ...
    def from_tree(self, node): ...

class NestedSequence(Sequence):
    count: bool
    def to_tree(self, tagname, obj, namespace: Incomplete | None = None): ...
    def from_tree(self, node): ...

class MultiSequence(Sequence):
    def __set__(self, instance: Serialisable | Strict, seq) -> None: ...
    def to_tree(self, tagname, obj, namespace: Incomplete | None = None) -> Generator[Incomplete, None, None]: ...

class MultiSequencePart(Alias):
    expected_type: type[Incomplete]
    store: Incomplete
    def __init__(self, expected_type, store) -> None: ...
    def __set__(self, instance: Serialisable | Strict, value) -> None: ...
    def __get__(self, instance: Unused, cls: Unused) -> Self: ...
