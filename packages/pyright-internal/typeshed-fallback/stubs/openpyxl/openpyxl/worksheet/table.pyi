from _typeshed import Incomplete

from openpyxl.descriptors import String
from openpyxl.descriptors.serialisable import Serialisable

TABLESTYLES: Incomplete
PIVOTSTYLES: Incomplete

class TableStyleInfo(Serialisable):
    tagname: str
    name: Incomplete
    showFirstColumn: Incomplete
    showLastColumn: Incomplete
    showRowStripes: Incomplete
    showColumnStripes: Incomplete
    def __init__(
        self,
        name: Incomplete | None = None,
        showFirstColumn: Incomplete | None = None,
        showLastColumn: Incomplete | None = None,
        showRowStripes: Incomplete | None = None,
        showColumnStripes: Incomplete | None = None,
    ) -> None: ...

class XMLColumnProps(Serialisable):
    tagname: str
    mapId: Incomplete
    xpath: Incomplete
    denormalized: Incomplete
    xmlDataType: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        mapId: Incomplete | None = None,
        xpath: Incomplete | None = None,
        denormalized: Incomplete | None = None,
        xmlDataType: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class TableFormula(Serialisable):
    tagname: str
    array: Incomplete
    attr_text: Incomplete
    text: Incomplete
    def __init__(self, array: Incomplete | None = None, attr_text: Incomplete | None = None) -> None: ...

class TableColumn(Serialisable):
    tagname: str
    id: Incomplete
    uniqueName: Incomplete
    name: Incomplete
    totalsRowFunction: Incomplete
    totalsRowLabel: Incomplete
    queryTableFieldId: Incomplete
    headerRowDxfId: Incomplete
    dataDxfId: Incomplete
    totalsRowDxfId: Incomplete
    headerRowCellStyle: Incomplete
    dataCellStyle: Incomplete
    totalsRowCellStyle: Incomplete
    calculatedColumnFormula: Incomplete
    totalsRowFormula: Incomplete
    xmlColumnPr: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        id: Incomplete | None = None,
        uniqueName: Incomplete | None = None,
        name: Incomplete | None = None,
        totalsRowFunction: Incomplete | None = None,
        totalsRowLabel: Incomplete | None = None,
        queryTableFieldId: Incomplete | None = None,
        headerRowDxfId: Incomplete | None = None,
        dataDxfId: Incomplete | None = None,
        totalsRowDxfId: Incomplete | None = None,
        headerRowCellStyle: Incomplete | None = None,
        dataCellStyle: Incomplete | None = None,
        totalsRowCellStyle: Incomplete | None = None,
        calculatedColumnFormula: Incomplete | None = None,
        totalsRowFormula: Incomplete | None = None,
        xmlColumnPr: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...
    def __iter__(self): ...
    @classmethod
    def from_tree(cls, node): ...

class TableNameDescriptor(String):
    def __set__(self, instance, value) -> None: ...

class Table(Serialisable):
    mime_type: str
    tagname: str
    id: Incomplete
    name: Incomplete
    displayName: Incomplete
    comment: Incomplete
    ref: Incomplete
    tableType: Incomplete
    headerRowCount: Incomplete
    insertRow: Incomplete
    insertRowShift: Incomplete
    totalsRowCount: Incomplete
    totalsRowShown: Incomplete
    published: Incomplete
    headerRowDxfId: Incomplete
    dataDxfId: Incomplete
    totalsRowDxfId: Incomplete
    headerRowBorderDxfId: Incomplete
    tableBorderDxfId: Incomplete
    totalsRowBorderDxfId: Incomplete
    headerRowCellStyle: Incomplete
    dataCellStyle: Incomplete
    totalsRowCellStyle: Incomplete
    connectionId: Incomplete
    autoFilter: Incomplete
    sortState: Incomplete
    tableColumns: Incomplete
    tableStyleInfo: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        id: int = 1,
        displayName: Incomplete | None = None,
        ref: Incomplete | None = None,
        name: Incomplete | None = None,
        comment: Incomplete | None = None,
        tableType: Incomplete | None = None,
        headerRowCount: int = 1,
        insertRow: Incomplete | None = None,
        insertRowShift: Incomplete | None = None,
        totalsRowCount: Incomplete | None = None,
        totalsRowShown: Incomplete | None = None,
        published: Incomplete | None = None,
        headerRowDxfId: Incomplete | None = None,
        dataDxfId: Incomplete | None = None,
        totalsRowDxfId: Incomplete | None = None,
        headerRowBorderDxfId: Incomplete | None = None,
        tableBorderDxfId: Incomplete | None = None,
        totalsRowBorderDxfId: Incomplete | None = None,
        headerRowCellStyle: Incomplete | None = None,
        dataCellStyle: Incomplete | None = None,
        totalsRowCellStyle: Incomplete | None = None,
        connectionId: Incomplete | None = None,
        autoFilter: Incomplete | None = None,
        sortState: Incomplete | None = None,
        tableColumns=(),
        tableStyleInfo: Incomplete | None = None,
        extLst: Incomplete | None = None,
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
    __elements__: Incomplete
    __attrs__: Incomplete
    def __init__(self, count: Incomplete | None = None, tablePart=()) -> None: ...
    def append(self, part) -> None: ...
    @property
    def count(self): ...
    def __bool__(self) -> bool: ...

class TableList(dict[Incomplete, Incomplete]):
    def add(self, table) -> None: ...
    def get(self, name: Incomplete | None = None, table_range: Incomplete | None = None): ...
    def items(self): ...
