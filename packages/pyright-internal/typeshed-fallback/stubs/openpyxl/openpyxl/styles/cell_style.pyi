from _typeshed import Incomplete
from array import array

from openpyxl.descriptors.serialisable import Serialisable

class ArrayDescriptor:
    key: Incomplete
    def __init__(self, key) -> None: ...
    def __get__(self, instance, cls): ...
    def __set__(self, instance, value) -> None: ...

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
    numFmtId: Incomplete
    fontId: Incomplete
    fillId: Incomplete
    borderId: Incomplete
    xfId: Incomplete
    quotePrefix: Incomplete
    pivotButton: Incomplete
    applyNumberFormat: Incomplete
    applyFont: Incomplete
    applyFill: Incomplete
    applyBorder: Incomplete
    # Overwritten by properties below
    # applyAlignment: Bool
    # applyProtection: Bool
    alignment: Incomplete
    protection: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    __attrs__: Incomplete
    def __init__(
        self,
        numFmtId: int = 0,
        fontId: int = 0,
        fillId: int = 0,
        borderId: int = 0,
        xfId: Incomplete | None = None,
        quotePrefix: Incomplete | None = None,
        pivotButton: Incomplete | None = None,
        applyNumberFormat: Incomplete | None = None,
        applyFont: Incomplete | None = None,
        applyFill: Incomplete | None = None,
        applyBorder: Incomplete | None = None,
        applyAlignment: Incomplete | None = None,
        applyProtection: Incomplete | None = None,
        alignment: Incomplete | None = None,
        protection: Incomplete | None = None,
        extLst: Incomplete | None = None,
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
    __attrs__: Incomplete
    # Overwritten by property below
    # count: Integer
    xf: Incomplete
    alignment: Incomplete
    protection: Incomplete
    __elements__: Incomplete
    def __init__(self, count: Incomplete | None = None, xf=()) -> None: ...
    @property
    def count(self): ...
    def __getitem__(self, idx): ...
