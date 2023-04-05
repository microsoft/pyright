from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class Point2D(Serialisable):
    tagname: str
    namespace: Incomplete
    x: Incomplete
    y: Incomplete
    def __init__(self, x: Incomplete | None = None, y: Incomplete | None = None) -> None: ...

class PositiveSize2D(Serialisable):
    tagname: str
    namespace: Incomplete
    cx: Incomplete
    width: Incomplete
    cy: Incomplete
    height: Incomplete
    def __init__(self, cx: Incomplete | None = None, cy: Incomplete | None = None) -> None: ...

class Transform2D(Serialisable):
    tagname: str
    namespace: Incomplete
    rot: Incomplete
    flipH: Incomplete
    flipV: Incomplete
    off: Incomplete
    ext: Incomplete
    chOff: Incomplete
    chExt: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        rot: Incomplete | None = None,
        flipH: Incomplete | None = None,
        flipV: Incomplete | None = None,
        off: Incomplete | None = None,
        ext: Incomplete | None = None,
        chOff: Incomplete | None = None,
        chExt: Incomplete | None = None,
    ) -> None: ...

class GroupTransform2D(Serialisable):
    tagname: str
    namespace: Incomplete
    rot: Incomplete
    flipH: Incomplete
    flipV: Incomplete
    off: Incomplete
    ext: Incomplete
    chOff: Incomplete
    chExt: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        rot: int = 0,
        flipH: Incomplete | None = None,
        flipV: Incomplete | None = None,
        off: Incomplete | None = None,
        ext: Incomplete | None = None,
        chOff: Incomplete | None = None,
        chExt: Incomplete | None = None,
    ) -> None: ...

class SphereCoords(Serialisable):
    tagname: str
    lat: Incomplete
    lon: Incomplete
    rev: Incomplete
    def __init__(self, lat: Incomplete | None = None, lon: Incomplete | None = None, rev: Incomplete | None = None) -> None: ...

class Camera(Serialisable):
    tagname: str
    prst: Incomplete
    fov: Incomplete
    zoom: Incomplete
    rot: Incomplete
    def __init__(
        self,
        prst: Incomplete | None = None,
        fov: Incomplete | None = None,
        zoom: Incomplete | None = None,
        rot: Incomplete | None = None,
    ) -> None: ...

class LightRig(Serialisable):
    tagname: str
    rig: Incomplete
    dir: Incomplete
    rot: Incomplete
    def __init__(self, rig: Incomplete | None = None, dir: Incomplete | None = None, rot: Incomplete | None = None) -> None: ...

class Vector3D(Serialisable):
    tagname: str
    dx: Incomplete
    dy: Incomplete
    dz: Incomplete
    def __init__(self, dx: Incomplete | None = None, dy: Incomplete | None = None, dz: Incomplete | None = None) -> None: ...

class Point3D(Serialisable):
    tagname: str
    x: Incomplete
    y: Incomplete
    z: Incomplete
    def __init__(self, x: Incomplete | None = None, y: Incomplete | None = None, z: Incomplete | None = None) -> None: ...

class Backdrop(Serialisable):
    anchor: Incomplete
    norm: Incomplete
    up: Incomplete
    extLst: Incomplete
    def __init__(
        self,
        anchor: Incomplete | None = None,
        norm: Incomplete | None = None,
        up: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class Scene3D(Serialisable):
    camera: Incomplete
    lightRig: Incomplete
    backdrop: Incomplete
    extLst: Incomplete
    def __init__(
        self,
        camera: Incomplete | None = None,
        lightRig: Incomplete | None = None,
        backdrop: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class Bevel(Serialisable):
    tagname: str
    w: Incomplete
    h: Incomplete
    prst: Incomplete
    def __init__(self, w: Incomplete | None = None, h: Incomplete | None = None, prst: Incomplete | None = None) -> None: ...

class Shape3D(Serialisable):
    namespace: Incomplete
    z: Incomplete
    extrusionH: Incomplete
    contourW: Incomplete
    prstMaterial: Incomplete
    bevelT: Incomplete
    bevelB: Incomplete
    extrusionClr: Incomplete
    contourClr: Incomplete
    extLst: Incomplete
    def __init__(
        self,
        z: Incomplete | None = None,
        extrusionH: Incomplete | None = None,
        contourW: Incomplete | None = None,
        prstMaterial: Incomplete | None = None,
        bevelT: Incomplete | None = None,
        bevelB: Incomplete | None = None,
        extrusionClr: Incomplete | None = None,
        contourClr: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class Path2D(Serialisable):
    w: Incomplete
    h: Incomplete
    fill: Incomplete
    stroke: Incomplete
    extrusionOk: Incomplete
    def __init__(
        self,
        w: Incomplete | None = None,
        h: Incomplete | None = None,
        fill: Incomplete | None = None,
        stroke: Incomplete | None = None,
        extrusionOk: Incomplete | None = None,
    ) -> None: ...

class Path2DList(Serialisable):
    path: Incomplete
    def __init__(self, path: Incomplete | None = None) -> None: ...

class GeomRect(Serialisable):
    l: Incomplete
    t: Incomplete
    r: Incomplete
    b: Incomplete
    def __init__(
        self, l: Incomplete | None = None, t: Incomplete | None = None, r: Incomplete | None = None, b: Incomplete | None = None
    ) -> None: ...

class AdjPoint2D(Serialisable):
    x: Incomplete
    y: Incomplete
    def __init__(self, x: Incomplete | None = None, y: Incomplete | None = None) -> None: ...

class ConnectionSite(Serialisable):
    ang: Incomplete
    pos: Incomplete
    def __init__(self, ang: Incomplete | None = None, pos: Incomplete | None = None) -> None: ...

class ConnectionSiteList(Serialisable):
    cxn: Incomplete
    def __init__(self, cxn: Incomplete | None = None) -> None: ...

class AdjustHandleList(Serialisable): ...

class GeomGuide(Serialisable):
    name: Incomplete
    fmla: Incomplete
    def __init__(self, name: Incomplete | None = None, fmla: Incomplete | None = None) -> None: ...

class GeomGuideList(Serialisable):
    gd: Incomplete
    def __init__(self, gd: Incomplete | None = None) -> None: ...

class CustomGeometry2D(Serialisable):
    avLst: Incomplete
    gdLst: Incomplete
    ahLst: Incomplete
    cxnLst: Incomplete
    pathLst: Incomplete
    rect: Incomplete
    def __init__(
        self,
        avLst: Incomplete | None = None,
        gdLst: Incomplete | None = None,
        ahLst: Incomplete | None = None,
        cxnLst: Incomplete | None = None,
        rect: Incomplete | None = None,
        pathLst: Incomplete | None = None,
    ) -> None: ...

class PresetGeometry2D(Serialisable):
    namespace: Incomplete
    prst: Incomplete
    avLst: Incomplete
    def __init__(self, prst: Incomplete | None = None, avLst: Incomplete | None = None) -> None: ...

class FontReference(Serialisable):
    idx: Incomplete
    def __init__(self, idx: Incomplete | None = None) -> None: ...

class StyleMatrixReference(Serialisable):
    idx: Incomplete
    def __init__(self, idx: Incomplete | None = None) -> None: ...

class ShapeStyle(Serialisable):
    lnRef: Incomplete
    fillRef: Incomplete
    effectRef: Incomplete
    fontRef: Incomplete
    def __init__(
        self,
        lnRef: Incomplete | None = None,
        fillRef: Incomplete | None = None,
        effectRef: Incomplete | None = None,
        fontRef: Incomplete | None = None,
    ) -> None: ...
