from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class ControlProperty(Serialisable):
    tagname: str
    anchor: Incomplete
    locked: Incomplete
    defaultSize: Incomplete
    disabled: Incomplete
    recalcAlways: Incomplete
    uiObject: Incomplete
    autoFill: Incomplete
    autoLine: Incomplete
    autoPict: Incomplete
    macro: Incomplete
    altText: Incomplete
    linkedCell: Incomplete
    listFillRange: Incomplete
    cf: Incomplete
    id: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        anchor: Incomplete | None = None,
        locked: bool = True,
        defaultSize: bool = True,
        _print: bool = True,
        disabled: bool = False,
        recalcAlways: bool = False,
        uiObject: bool = False,
        autoFill: bool = True,
        autoLine: bool = True,
        autoPict: bool = True,
        macro: Incomplete | None = None,
        altText: Incomplete | None = None,
        linkedCell: Incomplete | None = None,
        listFillRange: Incomplete | None = None,
        cf: str = "pict",
        id: Incomplete | None = None,
    ) -> None: ...

class Control(Serialisable):
    tagname: str
    controlPr: Incomplete
    shapeId: Incomplete
    name: Incomplete
    __elements__: Incomplete
    def __init__(
        self, controlPr: Incomplete | None = None, shapeId: Incomplete | None = None, name: Incomplete | None = None
    ) -> None: ...

class Controls(Serialisable):
    tagname: str
    control: Incomplete
    __elements__: Incomplete
    def __init__(self, control=()) -> None: ...
