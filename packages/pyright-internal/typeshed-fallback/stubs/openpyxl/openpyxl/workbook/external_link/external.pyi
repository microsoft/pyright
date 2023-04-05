from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class ExternalCell(Serialisable):  # type: ignore[misc]
    r: Incomplete
    t: Incomplete
    vm: Incomplete
    v: Incomplete
    def __init__(
        self, r: Incomplete | None = None, t: Incomplete | None = None, vm: Incomplete | None = None, v: Incomplete | None = None
    ) -> None: ...

class ExternalRow(Serialisable):  # type: ignore[misc]
    r: Incomplete
    cell: Incomplete
    __elements__: Incomplete
    def __init__(self, r=(), cell: Incomplete | None = None) -> None: ...

class ExternalSheetData(Serialisable):  # type: ignore[misc]
    sheetId: Incomplete
    refreshError: Incomplete
    row: Incomplete
    __elements__: Incomplete
    def __init__(self, sheetId: Incomplete | None = None, refreshError: Incomplete | None = None, row=()) -> None: ...

class ExternalSheetDataSet(Serialisable):  # type: ignore[misc]
    sheetData: Incomplete
    __elements__: Incomplete
    def __init__(self, sheetData: Incomplete | None = None) -> None: ...

class ExternalSheetNames(Serialisable):  # type: ignore[misc]
    sheetName: Incomplete
    __elements__: Incomplete
    def __init__(self, sheetName=()) -> None: ...

class ExternalDefinedName(Serialisable):
    tagname: str
    name: Incomplete
    refersTo: Incomplete
    sheetId: Incomplete
    def __init__(
        self, name: Incomplete | None = None, refersTo: Incomplete | None = None, sheetId: Incomplete | None = None
    ) -> None: ...

class ExternalBook(Serialisable):
    tagname: str
    sheetNames: Incomplete
    definedNames: Incomplete
    sheetDataSet: Incomplete
    id: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        sheetNames: Incomplete | None = None,
        definedNames=(),
        sheetDataSet: Incomplete | None = None,
        id: Incomplete | None = None,
    ) -> None: ...

class ExternalLink(Serialisable):
    tagname: str
    mime_type: str
    externalBook: Incomplete
    file_link: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        externalBook: Incomplete | None = None,
        ddeLink: Incomplete | None = None,
        oleLink: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...
    def to_tree(self): ...
    @property
    def path(self): ...

def read_external_link(archive, book_path): ...
