from _typeshed import Incomplete, Unused
from collections.abc import Callable, Iterator
from typing import ClassVar, Generic, TypeVar
from typing_extensions import Self

from openpyxl.descriptors import Strict
from openpyxl.descriptors.base import Alias, Bool, Float, Integer, String
from openpyxl.descriptors.serialisable import Serialisable
from openpyxl.styles.styleable import StyleableObject
from openpyxl.utils.bound_dictionary import BoundDictionary
from openpyxl.worksheet.worksheet import Worksheet
from openpyxl.xml.functions import Element

_DimT = TypeVar("_DimT", bound=Dimension)

class Dimension(Strict, StyleableObject):
    __fields__: ClassVar[tuple[str, ...]]

    index: Integer
    hidden: Bool
    outlineLevel: Integer
    outline_level: Alias
    collapsed: Bool
    style: Alias

    def __init__(
        self,
        index: int,
        hidden: bool,
        outlineLevel: int | None,
        collapsed: bool,
        worksheet: Worksheet,
        visible: bool = True,
        style: Incomplete | None = None,
    ) -> None: ...
    def __iter__(self) -> Iterator[tuple[str, str]]: ...
    def __copy__(self) -> Self: ...

class RowDimension(Dimension):
    r: Alias
    s: Alias
    ht: Float
    height: Alias
    thickBot: Bool
    thickTop: Bool

    def __init__(
        self,
        worksheet: Worksheet,
        index: int = 0,
        ht: Incomplete | None = None,
        customHeight: Incomplete | None = None,
        s: Incomplete | None = None,
        customFormat: Incomplete | None = None,
        hidden: bool = False,
        outlineLevel: int = 0,
        outline_level: Incomplete | None = None,
        collapsed: bool = False,
        visible: Incomplete | None = None,
        height: Incomplete | None = None,
        r: Incomplete | None = None,
        spans: Incomplete | None = None,
        thickBot: Incomplete | None = None,
        thickTop: Incomplete | None = None,
        **kw: Unused,
    ) -> None: ...
    @property
    def customFormat(self) -> bool: ...
    @property
    def customHeight(self) -> bool: ...

class ColumnDimension(Dimension):
    width: Float
    bestFit: Bool
    auto_size: Alias
    index: String  # type: ignore[assignment]
    min: Integer
    max: Integer
    collapsed: Bool

    def __init__(
        self,
        worksheet: Worksheet,
        index: str = "A",
        width: int = 13,
        bestFit: bool = False,
        hidden: bool = False,
        outlineLevel: int = 0,
        outline_level: int | None = None,
        collapsed: bool = False,
        style: Incomplete | None = None,
        min: int | None = None,
        max: int | None = None,
        customWidth: bool = False,
        visible: bool | None = None,
        auto_size: bool | None = None,
    ) -> None: ...
    @property
    def customWidth(self) -> bool: ...
    def reindex(self) -> None: ...
    def to_tree(self) -> Element | None: ...

class DimensionHolder(BoundDictionary[str, _DimT], Generic[_DimT]):
    worksheet: Worksheet
    max_outline: int | None
    default_factory: Callable[[], _DimT] | None

    def __init__(
        self, worksheet: Worksheet, reference: str = "index", default_factory: Callable[[], _DimT] | None = None
    ) -> None: ...
    def group(self, start: str, end: str | None = None, outline_level: int = 1, hidden: bool = False) -> None: ...
    def to_tree(self) -> Element | None: ...

class SheetFormatProperties(Serialisable):
    tagname: str
    baseColWidth: Incomplete
    defaultColWidth: Incomplete
    defaultRowHeight: Incomplete
    customHeight: Incomplete
    zeroHeight: Incomplete
    thickTop: Incomplete
    thickBottom: Incomplete
    outlineLevelRow: Incomplete
    outlineLevelCol: Incomplete
    def __init__(
        self,
        baseColWidth: int = 8,
        defaultColWidth: Incomplete | None = None,
        defaultRowHeight: int = 15,
        customHeight: Incomplete | None = None,
        zeroHeight: Incomplete | None = None,
        thickTop: Incomplete | None = None,
        thickBottom: Incomplete | None = None,
        outlineLevelRow: Incomplete | None = None,
        outlineLevelCol: Incomplete | None = None,
    ) -> None: ...

class SheetDimension(Serialisable):
    tagname: str
    ref: Incomplete
    def __init__(self, ref: Incomplete | None = None) -> None: ...
    @property
    def boundaries(self): ...
