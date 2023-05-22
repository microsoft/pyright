from _typeshed import Incomplete, Unused
from array import array
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.descriptors import Strict
from openpyxl.descriptors.base import Bool, Integer, Typed, _ConvertibleToBool, _ConvertibleToInt
from openpyxl.descriptors.excel import ExtensionList
from openpyxl.descriptors.serialisable import Serialisable
from openpyxl.styles.alignment import Alignment
from openpyxl.styles.protection import Protection

class ArrayDescriptor:
    key: Incomplete
    def __init__(self, key) -> None: ...
    def __get__(self, instance: Serialisable | Strict, cls: Unused): ...
    def __set__(self, instance: Serialisable | Strict, value) -> None: ...

class StyleArray(array[Incomplete]):
    tagname: str
    fontId: Incomplete
    fillId: Incomplete
    borderId: Incomplete
    numFmtId: Incomplete
    protectionId: Incomplete
    alignmentId: Incomplete
    pivotButton: Incomplete
    quotePrefix: Incomplete
    xfId: Incomplete
    def __new__(cls, args=[0, 0, 0, 0, 0, 0, 0, 0, 0]): ...
    def __hash__(self) -> int: ...
    def __copy__(self): ...
    def __deepcopy__(self, memo): ...

class CellStyle(Serialisable):
    tagname: str
    numFmtId: Integer[Literal[False]]
    fontId: Integer[Literal[False]]
    fillId: Integer[Literal[False]]
    borderId: Integer[Literal[False]]
    xfId: Integer[Literal[True]]
    quotePrefix: Bool[Literal[True]]
    pivotButton: Bool[Literal[True]]
    applyNumberFormat: Bool[Literal[True]]
    applyFont: Bool[Literal[True]]
    applyFill: Bool[Literal[True]]
    applyBorder: Bool[Literal[True]]
    # Overwritten by properties below
    # applyAlignment: Bool[Literal[True]]
    # applyProtection: Bool[Literal[True]]
    alignment: Typed[Alignment, Literal[True]]
    protection: Typed[Protection, Literal[True]]
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    __attrs__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        numFmtId: _ConvertibleToInt = 0,
        fontId: _ConvertibleToInt = 0,
        fillId: _ConvertibleToInt = 0,
        borderId: _ConvertibleToInt = 0,
        xfId: _ConvertibleToInt | None = None,
        quotePrefix: _ConvertibleToBool | None = None,
        pivotButton: _ConvertibleToBool | None = None,
        applyNumberFormat: _ConvertibleToBool | None = None,
        applyFont: _ConvertibleToBool | None = None,
        applyFill: _ConvertibleToBool | None = None,
        applyBorder: _ConvertibleToBool | None = None,
        applyAlignment: Unused = None,
        applyProtection: Unused = None,
        alignment: Alignment | None = None,
        protection: Protection | None = None,
        extLst: Unused = None,
    ) -> None: ...
    def to_array(self): ...
    @classmethod
    def from_array(cls, style): ...
    @property
    def applyProtection(self): ...
    @property
    def applyAlignment(self): ...

class CellStyleList(Serialisable):
    tagname: str
    __attrs__: ClassVar[tuple[str, ...]]
    # Overwritten by property below
    # count: Integer
    xf: Incomplete
    alignment: Incomplete
    protection: Incomplete
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(self, count: Unused = None, xf=()) -> None: ...
    @property
    def count(self): ...
    def __getitem__(self, idx): ...
