from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class ChartContainer(Serialisable):
    tagname: str
    title: Incomplete
    autoTitleDeleted: Incomplete
    pivotFmts: Incomplete
    view3D: Incomplete
    floor: Incomplete
    sideWall: Incomplete
    backWall: Incomplete
    plotArea: Incomplete
    legend: Incomplete
    plotVisOnly: Incomplete
    dispBlanksAs: Incomplete
    showDLblsOverMax: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        title: Incomplete | None = None,
        autoTitleDeleted: Incomplete | None = None,
        pivotFmts=(),
        view3D: Incomplete | None = None,
        floor: Incomplete | None = None,
        sideWall: Incomplete | None = None,
        backWall: Incomplete | None = None,
        plotArea: Incomplete | None = None,
        legend: Incomplete | None = None,
        plotVisOnly: bool = True,
        dispBlanksAs: str = "gap",
        showDLblsOverMax: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class Protection(Serialisable):
    tagname: str
    chartObject: Incomplete
    data: Incomplete
    formatting: Incomplete
    selection: Incomplete
    userInterface: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        chartObject: Incomplete | None = None,
        data: Incomplete | None = None,
        formatting: Incomplete | None = None,
        selection: Incomplete | None = None,
        userInterface: Incomplete | None = None,
    ) -> None: ...

class ExternalData(Serialisable):
    tagname: str
    autoUpdate: Incomplete
    id: Incomplete
    def __init__(self, autoUpdate: Incomplete | None = None, id: Incomplete | None = None) -> None: ...

class ChartSpace(Serialisable):
    tagname: str
    date1904: Incomplete
    lang: Incomplete
    roundedCorners: Incomplete
    style: Incomplete
    clrMapOvr: Incomplete
    pivotSource: Incomplete
    protection: Incomplete
    chart: Incomplete
    spPr: Incomplete
    graphicalProperties: Incomplete
    txPr: Incomplete
    textProperties: Incomplete
    externalData: Incomplete
    printSettings: Incomplete
    userShapes: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        date1904: Incomplete | None = None,
        lang: Incomplete | None = None,
        roundedCorners: Incomplete | None = None,
        style: Incomplete | None = None,
        clrMapOvr: Incomplete | None = None,
        pivotSource: Incomplete | None = None,
        protection: Incomplete | None = None,
        chart: Incomplete | None = None,
        spPr: Incomplete | None = None,
        txPr: Incomplete | None = None,
        externalData: Incomplete | None = None,
        printSettings: Incomplete | None = None,
        userShapes: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...
    def to_tree(self, tagname: Incomplete | None = None, idx: Incomplete | None = None, namespace: Incomplete | None = None): ...
