from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class PictureLocking(Serialisable):
    tagname: str
    namespace: Incomplete
    noCrop: Incomplete
    noGrp: Incomplete
    noSelect: Incomplete
    noRot: Incomplete
    noChangeAspect: Incomplete
    noMove: Incomplete
    noResize: Incomplete
    noEditPoints: Incomplete
    noAdjustHandles: Incomplete
    noChangeArrowheads: Incomplete
    noChangeShapeType: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        noCrop: Incomplete | None = None,
        noGrp: Incomplete | None = None,
        noSelect: Incomplete | None = None,
        noRot: Incomplete | None = None,
        noChangeAspect: Incomplete | None = None,
        noMove: Incomplete | None = None,
        noResize: Incomplete | None = None,
        noEditPoints: Incomplete | None = None,
        noAdjustHandles: Incomplete | None = None,
        noChangeArrowheads: Incomplete | None = None,
        noChangeShapeType: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class NonVisualPictureProperties(Serialisable):
    tagname: str
    preferRelativeResize: Incomplete
    picLocks: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self, preferRelativeResize: Incomplete | None = None, picLocks: Incomplete | None = None, extLst: Incomplete | None = None
    ) -> None: ...

class PictureNonVisual(Serialisable):
    tagname: str
    cNvPr: Incomplete
    cNvPicPr: Incomplete
    __elements__: Incomplete
    def __init__(self, cNvPr: Incomplete | None = None, cNvPicPr: Incomplete | None = None) -> None: ...

class PictureFrame(Serialisable):
    tagname: str
    macro: Incomplete
    fPublished: Incomplete
    nvPicPr: Incomplete
    blipFill: Incomplete
    spPr: Incomplete
    graphicalProperties: Incomplete
    style: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        macro: Incomplete | None = None,
        fPublished: Incomplete | None = None,
        nvPicPr: Incomplete | None = None,
        blipFill: Incomplete | None = None,
        spPr: Incomplete | None = None,
        style: Incomplete | None = None,
    ) -> None: ...
