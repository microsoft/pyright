from _typeshed import Incomplete, Unused
from typing import ClassVar, overload
from typing_extensions import Literal, TypeAlias

from openpyxl.descriptors import Strict, String
from openpyxl.descriptors.base import Alias, Bool, Integer, NoneSet, Typed, _ConvertibleToBool, _ConvertibleToInt
from openpyxl.descriptors.excel import ExtensionList
from openpyxl.descriptors.serialisable import Serialisable
from openpyxl.worksheet.filters import AutoFilter, SortState

_TableColumnTotalsRowFunction: TypeAlias = Literal[
    "sum", "min", "max", "average", "count", "countNums", "stdDev", "var", "custom"
]
_TableTableType: TypeAlias = Literal["worksheet", "xml", "queryTable"]

TABLESTYLES: Incomplete
PIVOTSTYLES: Incomplete

class TableStyleInfo(Serialisable):
    tagname: str
    name: String[Literal[True]]
    showFirstColumn: Bool[Literal[True]]
    showLastColumn: Bool[Literal[True]]
    showRowStripes: Bool[Literal[True]]
    showColumnStripes: Bool[Literal[True]]
    def __init__(
        self,
        name: str | None = None,
        showFirstColumn: _ConvertibleToBool | None = None,
        showLastColumn: _ConvertibleToBool | None = None,
        showRowStripes: _ConvertibleToBool | None = None,
        showColumnStripes: _ConvertibleToBool | None = None,
    ) -> None: ...

class XMLColumnProps(Serialisable):
    tagname: str
    mapId: Integer[Literal[False]]
    xpath: String[Literal[False]]
    denormalized: Bool[Literal[True]]
    xmlDataType: String[Literal[False]]
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    @overload
    def __init__(
        self,
        mapId: _ConvertibleToInt,
        xpath: str,
        denormalized: _ConvertibleToBool | None = None,
        *,
        xmlDataType: str,
        extLst: Unused = None,
    ) -> None: ...
    @overload
    def __init__(
        self,
        mapId: _ConvertibleToInt,
        xpath: str,
        denormalized: _ConvertibleToBool | None,
        xmlDataType: str,
        extLst: Unused = None,
    ) -> None: ...

class TableFormula(Serialisable):
    tagname: str
    array: Bool[Literal[True]]
    attr_text: Incomplete
    text: Alias
    def __init__(self, array: _ConvertibleToBool | None = None, attr_text: Incomplete | None = None) -> None: ...

class TableColumn(Serialisable):
    tagname: str
    id: Integer[Literal[False]]
    uniqueName: String[Literal[True]]
    name: String[Literal[False]]
    totalsRowFunction: NoneSet[_TableColumnTotalsRowFunction]
    totalsRowLabel: String[Literal[True]]
    queryTableFieldId: Integer[Literal[True]]
    headerRowDxfId: Integer[Literal[True]]
    dataDxfId: Integer[Literal[True]]
    totalsRowDxfId: Integer[Literal[True]]
    headerRowCellStyle: String[Literal[True]]
    dataCellStyle: String[Literal[True]]
    totalsRowCellStyle: String[Literal[True]]
    calculatedColumnFormula: Typed[TableFormula, Literal[True]]
    totalsRowFormula: Typed[TableFormula, Literal[True]]
    xmlColumnPr: Typed[XMLColumnProps, Literal[True]]
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    @overload
    def __init__(
        self,
        id: _ConvertibleToInt,
        uniqueName: str | None = None,
        *,
        name: str,
        totalsRowFunction: _TableColumnTotalsRowFunction | Literal["none"] | None = None,
        totalsRowLabel: str | None = None,
        queryTableFieldId: _ConvertibleToInt | None = None,
        headerRowDxfId: _ConvertibleToInt | None = None,
        dataDxfId: _ConvertibleToInt | None = None,
        totalsRowDxfId: _ConvertibleToInt | None = None,
        headerRowCellStyle: str | None = None,
        dataCellStyle: str | None = None,
        totalsRowCellStyle: str | None = None,
        calculatedColumnFormula: TableFormula | None = None,
        totalsRowFormula: TableFormula | None = None,
        xmlColumnPr: XMLColumnProps | None = None,
        extLst: ExtensionList | None = None,
    ) -> None: ...
    @overload
    def __init__(
        self,
        id: _ConvertibleToInt,
        uniqueName: str | None,
        name: str,
        totalsRowFunction: _TableColumnTotalsRowFunction | Literal["none"] | None = None,
        totalsRowLabel: str | None = None,
        queryTableFieldId: _ConvertibleToInt | None = None,
        headerRowDxfId: _ConvertibleToInt | None = None,
        dataDxfId: _ConvertibleToInt | None = None,
        totalsRowDxfId: _ConvertibleToInt | None = None,
        headerRowCellStyle: str | None = None,
        dataCellStyle: str | None = None,
        totalsRowCellStyle: str | None = None,
        calculatedColumnFormula: TableFormula | None = None,
        totalsRowFormula: TableFormula | None = None,
        xmlColumnPr: XMLColumnProps | None = None,
        extLst: ExtensionList | None = None,
    ) -> None: ...
    def __iter__(self): ...
    @classmethod
    def from_tree(cls, node): ...

class TableNameDescriptor(String[Incomplete]):
    def __set__(self, instance: Serialisable | Strict, value) -> None: ...

class Table(Serialisable):
    mime_type: str
    tagname: str
    id: Integer[Literal[False]]
    name: String[Literal[True]]
    displayName: Incomplete
    comment: String[Literal[True]]
    ref: Incomplete
    tableType: NoneSet[_TableTableType]
    headerRowCount: Integer[Literal[True]]
    insertRow: Bool[Literal[True]]
    insertRowShift: Bool[Literal[True]]
    totalsRowCount: Integer[Literal[True]]
    totalsRowShown: Bool[Literal[True]]
    published: Bool[Literal[True]]
    headerRowDxfId: Integer[Literal[True]]
    dataDxfId: Integer[Literal[True]]
    totalsRowDxfId: Integer[Literal[True]]
    headerRowBorderDxfId: Integer[Literal[True]]
    tableBorderDxfId: Integer[Literal[True]]
    totalsRowBorderDxfId: Integer[Literal[True]]
    headerRowCellStyle: String[Literal[True]]
    dataCellStyle: String[Literal[True]]
    totalsRowCellStyle: String[Literal[True]]
    connectionId: Integer[Literal[True]]
    autoFilter: Typed[AutoFilter, Literal[True]]
    sortState: Typed[SortState, Literal[True]]
    tableColumns: Incomplete
    tableStyleInfo: Typed[TableStyleInfo, Literal[True]]
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        id: _ConvertibleToInt = 1,
        displayName: Incomplete | None = None,
        ref: Incomplete | None = None,
        name: str | None = None,
        comment: str | None = None,
        tableType: _TableTableType | Literal["none"] | None = None,
        headerRowCount: _ConvertibleToInt | None = 1,
        insertRow: _ConvertibleToBool | None = None,
        insertRowShift: _ConvertibleToBool | None = None,
        totalsRowCount: _ConvertibleToInt | None = None,
        totalsRowShown: _ConvertibleToBool | None = None,
        published: _ConvertibleToBool | None = None,
        headerRowDxfId: _ConvertibleToInt | None = None,
        dataDxfId: _ConvertibleToInt | None = None,
        totalsRowDxfId: _ConvertibleToInt | None = None,
        headerRowBorderDxfId: _ConvertibleToInt | None = None,
        tableBorderDxfId: _ConvertibleToInt | None = None,
        totalsRowBorderDxfId: _ConvertibleToInt | None = None,
        headerRowCellStyle: str | None = None,
        dataCellStyle: str | None = None,
        totalsRowCellStyle: str | None = None,
        connectionId: _ConvertibleToInt | None = None,
        autoFilter: AutoFilter | None = None,
        sortState: SortState | None = None,
        tableColumns=(),
        tableStyleInfo: TableStyleInfo | None = None,
        extLst: Unused = None,
    ) -> None: ...
    def to_tree(self): ...
    @property
    def path(self): ...
    @property
    def column_names(self): ...

class TablePartList(Serialisable):
    tagname: str
    # Overwritten by property below
    # count: Integer
    tablePart: Incomplete
    __elements__: ClassVar[tuple[str, ...]]
    __attrs__: ClassVar[tuple[str, ...]]
    def __init__(self, count: Unused = None, tablePart=()) -> None: ...
    def append(self, part) -> None: ...
    @property
    def count(self): ...
    def __bool__(self) -> bool: ...

class TableList(dict[Incomplete, Incomplete]):
    def add(self, table) -> None: ...
    def get(self, name: Incomplete | None = None, table_range: Incomplete | None = None): ...
    def items(self): ...
