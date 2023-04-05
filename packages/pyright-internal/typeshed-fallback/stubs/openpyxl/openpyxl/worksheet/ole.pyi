from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class ObjectAnchor(Serialisable):
    tagname: str
    to: Incomplete
    moveWithCells: Incomplete
    sizeWithCells: Incomplete
    z_order: Incomplete
    def __init__(
        self,
        _from: Incomplete | None = None,
        to: Incomplete | None = None,
        moveWithCells: bool = False,
        sizeWithCells: bool = False,
        z_order: Incomplete | None = None,
    ) -> None: ...

class ObjectPr(Serialisable):
    tagname: str
    anchor: Incomplete
    locked: Incomplete
    defaultSize: Incomplete
    disabled: Incomplete
    uiObject: Incomplete
    autoFill: Incomplete
    autoLine: Incomplete
    autoPict: Incomplete
    macro: Incomplete
    altText: Incomplete
    dde: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        anchor: Incomplete | None = None,
        locked: bool = True,
        defaultSize: bool = True,
        _print: bool = True,
        disabled: bool = False,
        uiObject: bool = False,
        autoFill: bool = True,
        autoLine: bool = True,
        autoPict: bool = True,
        macro: Incomplete | None = None,
        altText: Incomplete | None = None,
        dde: bool = False,
    ) -> None: ...

class OleObject(Serialisable):
    tagname: str
    objectPr: Incomplete
    progId: Incomplete
    dvAspect: Incomplete
    link: Incomplete
    oleUpdate: Incomplete
    autoLoad: Incomplete
    shapeId: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        objectPr: Incomplete | None = None,
        progId: Incomplete | None = None,
        dvAspect: str = "DVASPECT_CONTENT",
        link: Incomplete | None = None,
        oleUpdate: Incomplete | None = None,
        autoLoad: bool = False,
        shapeId: Incomplete | None = None,
    ) -> None: ...

class OleObjects(Serialisable):
    tagname: str
    oleObject: Incomplete
    __elements__: Incomplete
    def __init__(self, oleObject=()) -> None: ...
