from _typeshed import Incomplete, Unused
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.chart.picture import PictureOptions
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.descriptors.base import Alias, Typed
from openpyxl.descriptors.excel import ExtensionList
from openpyxl.descriptors.serialisable import Serialisable

class View3D(Serialisable):
    tagname: str
    rotX: Incomplete
    x_rotation: Alias
    hPercent: Incomplete
    height_percent: Alias
    rotY: Incomplete
    y_rotation: Alias
    depthPercent: Incomplete
    rAngAx: Incomplete
    right_angle_axes: Alias
    perspective: Incomplete
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        rotX: int = 15,
        hPercent: Incomplete | None = None,
        rotY: int = 20,
        depthPercent: Incomplete | None = None,
        rAngAx: bool = True,
        perspective: Incomplete | None = None,
        extLst: Unused = None,
    ) -> None: ...

class Surface(Serialisable):
    tagname: str
    thickness: Incomplete
    spPr: Typed[GraphicalProperties, Literal[True]]
    graphicalProperties: Alias
    pictureOptions: Typed[PictureOptions, Literal[True]]
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        thickness: Incomplete | None = None,
        spPr: GraphicalProperties | None = None,
        pictureOptions: PictureOptions | None = None,
        extLst: Unused = None,
    ) -> None: ...

class _3DBase(Serialisable):
    tagname: str
    view3D: Typed[View3D, Literal[True]]
    floor: Typed[Surface, Literal[True]]
    sideWall: Typed[Surface, Literal[True]]
    backWall: Typed[Surface, Literal[True]]
    def __init__(
        self,
        view3D: View3D | None = None,
        floor: Surface | None = None,
        sideWall: Surface | None = None,
        backWall: Surface | None = None,
    ) -> None: ...
