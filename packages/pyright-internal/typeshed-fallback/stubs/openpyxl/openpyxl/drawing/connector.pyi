from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class Connection(Serialisable):
    id: Incomplete
    idx: Incomplete
    def __init__(self, id: Incomplete | None = None, idx: Incomplete | None = None) -> None: ...

class ConnectorLocking(Serialisable):
    extLst: Incomplete
    def __init__(self, extLst: Incomplete | None = None) -> None: ...

class NonVisualConnectorProperties(Serialisable):
    cxnSpLocks: Incomplete
    stCxn: Incomplete
    endCxn: Incomplete
    extLst: Incomplete
    def __init__(
        self,
        cxnSpLocks: Incomplete | None = None,
        stCxn: Incomplete | None = None,
        endCxn: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class ConnectorNonVisual(Serialisable):
    cNvPr: Incomplete
    cNvCxnSpPr: Incomplete
    __elements__: Incomplete
    def __init__(self, cNvPr: Incomplete | None = None, cNvCxnSpPr: Incomplete | None = None) -> None: ...

class ConnectorShape(Serialisable):
    tagname: str
    nvCxnSpPr: Incomplete
    spPr: Incomplete
    style: Incomplete
    macro: Incomplete
    fPublished: Incomplete
    def __init__(
        self,
        nvCxnSpPr: Incomplete | None = None,
        spPr: Incomplete | None = None,
        style: Incomplete | None = None,
        macro: Incomplete | None = None,
        fPublished: Incomplete | None = None,
    ) -> None: ...

class ShapeMeta(Serialisable):
    tagname: str
    cNvPr: Incomplete
    cNvSpPr: Incomplete
    def __init__(self, cNvPr: Incomplete | None = None, cNvSpPr: Incomplete | None = None) -> None: ...

class Shape(Serialisable):
    macro: Incomplete
    textlink: Incomplete
    fPublished: Incomplete
    fLocksText: Incomplete
    nvSpPr: Incomplete
    meta: Incomplete
    spPr: Incomplete
    graphicalProperties: Incomplete
    style: Incomplete
    txBody: Incomplete
    def __init__(
        self,
        macro: Incomplete | None = None,
        textlink: Incomplete | None = None,
        fPublished: Incomplete | None = None,
        fLocksText: Incomplete | None = None,
        nvSpPr: Incomplete | None = None,
        spPr: Incomplete | None = None,
        style: Incomplete | None = None,
        txBody: Incomplete | None = None,
    ) -> None: ...
