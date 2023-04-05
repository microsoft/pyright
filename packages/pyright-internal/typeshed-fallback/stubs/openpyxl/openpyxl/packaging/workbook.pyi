from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class FileRecoveryProperties(Serialisable):
    tagname: str
    autoRecover: Incomplete
    crashSave: Incomplete
    dataExtractLoad: Incomplete
    repairLoad: Incomplete
    def __init__(
        self,
        autoRecover: Incomplete | None = None,
        crashSave: Incomplete | None = None,
        dataExtractLoad: Incomplete | None = None,
        repairLoad: Incomplete | None = None,
    ) -> None: ...

class ChildSheet(Serialisable):
    tagname: str
    name: Incomplete
    sheetId: Incomplete
    state: Incomplete
    id: Incomplete
    def __init__(
        self,
        name: Incomplete | None = None,
        sheetId: Incomplete | None = None,
        state: str = "visible",
        id: Incomplete | None = None,
    ) -> None: ...

class PivotCache(Serialisable):
    tagname: str
    cacheId: Incomplete
    id: Incomplete
    def __init__(self, cacheId: Incomplete | None = None, id: Incomplete | None = None) -> None: ...

class WorkbookPackage(Serialisable):
    tagname: str
    conformance: Incomplete
    fileVersion: Incomplete
    fileSharing: Incomplete
    workbookPr: Incomplete
    properties: Incomplete
    workbookProtection: Incomplete
    bookViews: Incomplete
    sheets: Incomplete
    functionGroups: Incomplete
    externalReferences: Incomplete
    definedNames: Incomplete
    calcPr: Incomplete
    oleSize: Incomplete
    customWorkbookViews: Incomplete
    pivotCaches: Incomplete
    smartTagPr: Incomplete
    smartTagTypes: Incomplete
    webPublishing: Incomplete
    fileRecoveryPr: Incomplete
    webPublishObjects: Incomplete
    extLst: Incomplete
    Ignorable: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        conformance: Incomplete | None = None,
        fileVersion: Incomplete | None = None,
        fileSharing: Incomplete | None = None,
        workbookPr: Incomplete | None = None,
        workbookProtection: Incomplete | None = None,
        bookViews=(),
        sheets=(),
        functionGroups: Incomplete | None = None,
        externalReferences=(),
        definedNames: Incomplete | None = None,
        calcPr: Incomplete | None = None,
        oleSize: Incomplete | None = None,
        customWorkbookViews=(),
        pivotCaches=(),
        smartTagPr: Incomplete | None = None,
        smartTagTypes: Incomplete | None = None,
        webPublishing: Incomplete | None = None,
        fileRecoveryPr: Incomplete | None = None,
        webPublishObjects: Incomplete | None = None,
        extLst: Incomplete | None = None,
        Ignorable: Incomplete | None = None,
    ) -> None: ...
    def to_tree(self): ...
    @property
    def active(self): ...
