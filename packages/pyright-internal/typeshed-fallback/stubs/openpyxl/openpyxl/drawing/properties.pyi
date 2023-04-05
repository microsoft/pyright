from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class GroupShapeProperties(Serialisable):
    tagname: str
    bwMode: Incomplete
    xfrm: Incomplete
    scene3d: Incomplete
    extLst: Incomplete
    def __init__(
        self,
        bwMode: Incomplete | None = None,
        xfrm: Incomplete | None = None,
        scene3d: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class GroupLocking(Serialisable):
    tagname: str
    namespace: Incomplete
    noGrp: Incomplete
    noUngrp: Incomplete
    noSelect: Incomplete
    noRot: Incomplete
    noChangeAspect: Incomplete
    noMove: Incomplete
    noResize: Incomplete
    noChangeArrowheads: Incomplete
    noEditPoints: Incomplete
    noAdjustHandles: Incomplete
    noChangeShapeType: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        noGrp: Incomplete | None = None,
        noUngrp: Incomplete | None = None,
        noSelect: Incomplete | None = None,
        noRot: Incomplete | None = None,
        noChangeAspect: Incomplete | None = None,
        noChangeArrowheads: Incomplete | None = None,
        noMove: Incomplete | None = None,
        noResize: Incomplete | None = None,
        noEditPoints: Incomplete | None = None,
        noAdjustHandles: Incomplete | None = None,
        noChangeShapeType: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class NonVisualGroupDrawingShapeProps(Serialisable):
    tagname: str
    grpSpLocks: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(self, grpSpLocks: Incomplete | None = None, extLst: Incomplete | None = None) -> None: ...

class NonVisualDrawingShapeProps(Serialisable):
    tagname: str
    spLocks: Incomplete
    txBax: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    txBox: Incomplete
    def __init__(
        self, spLocks: Incomplete | None = None, txBox: Incomplete | None = None, extLst: Incomplete | None = None
    ) -> None: ...

class NonVisualDrawingProps(Serialisable):
    tagname: str
    id: Incomplete
    name: Incomplete
    descr: Incomplete
    hidden: Incomplete
    title: Incomplete
    hlinkClick: Incomplete
    hlinkHover: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        id: Incomplete | None = None,
        name: Incomplete | None = None,
        descr: Incomplete | None = None,
        hidden: Incomplete | None = None,
        title: Incomplete | None = None,
        hlinkClick: Incomplete | None = None,
        hlinkHover: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class NonVisualGroupShape(Serialisable):
    tagname: str
    cNvPr: Incomplete
    cNvGrpSpPr: Incomplete
    __elements__: Incomplete
    def __init__(self, cNvPr: Incomplete | None = None, cNvGrpSpPr: Incomplete | None = None) -> None: ...
