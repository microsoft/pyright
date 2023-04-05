from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class PatternFillProperties(Serialisable):
    tagname: str
    namespace: Incomplete
    prst: Incomplete
    preset: Incomplete
    fgClr: Incomplete
    foreground: Incomplete
    bgClr: Incomplete
    background: Incomplete
    __elements__: Incomplete
    def __init__(
        self, prst: Incomplete | None = None, fgClr: Incomplete | None = None, bgClr: Incomplete | None = None
    ) -> None: ...

class RelativeRect(Serialisable):
    tagname: str
    namespace: Incomplete
    l: Incomplete
    left: Incomplete
    t: Incomplete
    top: Incomplete
    r: Incomplete
    right: Incomplete
    b: Incomplete
    bottom: Incomplete
    def __init__(
        self, l: Incomplete | None = None, t: Incomplete | None = None, r: Incomplete | None = None, b: Incomplete | None = None
    ) -> None: ...

class StretchInfoProperties(Serialisable):
    tagname: str
    namespace: Incomplete
    fillRect: Incomplete
    def __init__(self, fillRect=...) -> None: ...

class GradientStop(Serialisable):
    tagname: str
    namespace: Incomplete
    pos: Incomplete
    scrgbClr: Incomplete
    RGBPercent: Incomplete
    srgbClr: Incomplete
    RGB: Incomplete
    hslClr: Incomplete
    sysClr: Incomplete
    schemeClr: Incomplete
    prstClr: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        pos: Incomplete | None = None,
        scrgbClr: Incomplete | None = None,
        srgbClr: Incomplete | None = None,
        hslClr: Incomplete | None = None,
        sysClr: Incomplete | None = None,
        schemeClr: Incomplete | None = None,
        prstClr: Incomplete | None = None,
    ) -> None: ...

class LinearShadeProperties(Serialisable):
    tagname: str
    namespace: Incomplete
    ang: Incomplete
    scaled: Incomplete
    def __init__(self, ang: Incomplete | None = None, scaled: Incomplete | None = None) -> None: ...

class PathShadeProperties(Serialisable):
    tagname: str
    namespace: Incomplete
    path: Incomplete
    fillToRect: Incomplete
    def __init__(self, path: Incomplete | None = None, fillToRect: Incomplete | None = None) -> None: ...

class GradientFillProperties(Serialisable):
    tagname: str
    namespace: Incomplete
    flip: Incomplete
    rotWithShape: Incomplete
    gsLst: Incomplete
    stop_list: Incomplete
    lin: Incomplete
    linear: Incomplete
    path: Incomplete
    tileRect: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        flip: Incomplete | None = None,
        rotWithShape: Incomplete | None = None,
        gsLst=(),
        lin: Incomplete | None = None,
        path: Incomplete | None = None,
        tileRect: Incomplete | None = None,
    ) -> None: ...

class SolidColorFillProperties(Serialisable):
    tagname: str
    scrgbClr: Incomplete
    RGBPercent: Incomplete
    srgbClr: Incomplete
    RGB: Incomplete
    hslClr: Incomplete
    sysClr: Incomplete
    schemeClr: Incomplete
    prstClr: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        scrgbClr: Incomplete | None = None,
        srgbClr: Incomplete | None = None,
        hslClr: Incomplete | None = None,
        sysClr: Incomplete | None = None,
        schemeClr: Incomplete | None = None,
        prstClr: Incomplete | None = None,
    ) -> None: ...

class Blip(Serialisable):
    tagname: str
    namespace: Incomplete
    cstate: Incomplete
    embed: Incomplete
    link: Incomplete
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
    alphaBiLevel: Incomplete
    alphaCeiling: Incomplete
    alphaFloor: Incomplete
    alphaInv: Incomplete
    alphaMod: Incomplete
    alphaModFix: Incomplete
    alphaRepl: Incomplete
    biLevel: Incomplete
    blur: Incomplete
    clrChange: Incomplete
    clrRepl: Incomplete
    duotone: Incomplete
    fillOverlay: Incomplete
    grayscl: Incomplete
    hsl: Incomplete
    lum: Incomplete
    tint: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        cstate: Incomplete | None = None,
        embed: Incomplete | None = None,
        link: Incomplete | None = None,
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
        alphaBiLevel: Incomplete | None = None,
        alphaCeiling: Incomplete | None = None,
        alphaFloor: Incomplete | None = None,
        alphaInv: Incomplete | None = None,
        alphaMod: Incomplete | None = None,
        alphaModFix: Incomplete | None = None,
        alphaRepl: Incomplete | None = None,
        biLevel: Incomplete | None = None,
        blur: Incomplete | None = None,
        clrChange: Incomplete | None = None,
        clrRepl: Incomplete | None = None,
        duotone: Incomplete | None = None,
        fillOverlay: Incomplete | None = None,
        grayscl: Incomplete | None = None,
        hsl: Incomplete | None = None,
        lum: Incomplete | None = None,
        tint: Incomplete | None = None,
    ) -> None: ...

class TileInfoProperties(Serialisable):
    tx: Incomplete
    ty: Incomplete
    sx: Incomplete
    sy: Incomplete
    flip: Incomplete
    algn: Incomplete
    def __init__(
        self,
        tx: Incomplete | None = None,
        ty: Incomplete | None = None,
        sx: Incomplete | None = None,
        sy: Incomplete | None = None,
        flip: Incomplete | None = None,
        algn: Incomplete | None = None,
    ) -> None: ...

class BlipFillProperties(Serialisable):
    tagname: str
    dpi: Incomplete
    rotWithShape: Incomplete
    blip: Incomplete
    srcRect: Incomplete
    tile: Incomplete
    stretch: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        dpi: Incomplete | None = None,
        rotWithShape: Incomplete | None = None,
        blip: Incomplete | None = None,
        tile: Incomplete | None = None,
        stretch=...,
        srcRect: Incomplete | None = None,
    ) -> None: ...
