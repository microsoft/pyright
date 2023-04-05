from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

from .colors import ColorChoice

class TintEffect(Serialisable):
    tagname: str
    hue: Incomplete
    amt: Incomplete
    def __init__(self, hue: int = 0, amt: int = 0) -> None: ...

class LuminanceEffect(Serialisable):
    tagname: str
    bright: Incomplete
    contrast: Incomplete
    def __init__(self, bright: int = 0, contrast: int = 0) -> None: ...

class HSLEffect(Serialisable):
    hue: Incomplete
    sat: Incomplete
    lum: Incomplete
    def __init__(self, hue: Incomplete | None = None, sat: Incomplete | None = None, lum: Incomplete | None = None) -> None: ...

class GrayscaleEffect(Serialisable):
    tagname: str

class FillOverlayEffect(Serialisable):
    blend: Incomplete
    def __init__(self, blend: Incomplete | None = None) -> None: ...

class DuotoneEffect(Serialisable): ...
class ColorReplaceEffect(Serialisable): ...
class Color(Serialisable): ...

class ColorChangeEffect(Serialisable):
    useA: Incomplete
    clrFrom: Incomplete
    clrTo: Incomplete
    def __init__(
        self, useA: Incomplete | None = None, clrFrom: Incomplete | None = None, clrTo: Incomplete | None = None
    ) -> None: ...

class BlurEffect(Serialisable):
    rad: Incomplete
    grow: Incomplete
    def __init__(self, rad: Incomplete | None = None, grow: Incomplete | None = None) -> None: ...

class BiLevelEffect(Serialisable):
    thresh: Incomplete
    def __init__(self, thresh: Incomplete | None = None) -> None: ...

class AlphaReplaceEffect(Serialisable):
    a: Incomplete
    def __init__(self, a: Incomplete | None = None) -> None: ...

class AlphaModulateFixedEffect(Serialisable):
    amt: Incomplete
    def __init__(self, amt: Incomplete | None = None) -> None: ...

class EffectContainer(Serialisable):
    type: Incomplete
    name: Incomplete
    def __init__(self, type: Incomplete | None = None, name: Incomplete | None = None) -> None: ...

class AlphaModulateEffect(Serialisable):
    cont: Incomplete
    def __init__(self, cont: Incomplete | None = None) -> None: ...

class AlphaInverseEffect(Serialisable): ...
class AlphaFloorEffect(Serialisable): ...
class AlphaCeilingEffect(Serialisable): ...

class AlphaBiLevelEffect(Serialisable):
    thresh: Incomplete
    def __init__(self, thresh: Incomplete | None = None) -> None: ...

class GlowEffect(ColorChoice):
    rad: Incomplete
    scrgbClr: Incomplete
    srgbClr: Incomplete
    hslClr: Incomplete
    sysClr: Incomplete
    schemeClr: Incomplete
    prstClr: Incomplete
    __elements__: Incomplete
    def __init__(self, rad: Incomplete | None = None, **kw) -> None: ...

class InnerShadowEffect(ColorChoice):
    blurRad: Incomplete
    dist: Incomplete
    dir: Incomplete
    scrgbClr: Incomplete
    srgbClr: Incomplete
    hslClr: Incomplete
    sysClr: Incomplete
    schemeClr: Incomplete
    prstClr: Incomplete
    __elements__: Incomplete
    def __init__(
        self, blurRad: Incomplete | None = None, dist: Incomplete | None = None, dir: Incomplete | None = None, **kw
    ) -> None: ...

class OuterShadow(ColorChoice):
    tagname: str
    blurRad: Incomplete
    dist: Incomplete
    dir: Incomplete
    sx: Incomplete
    sy: Incomplete
    kx: Incomplete
    ky: Incomplete
    algn: Incomplete
    rotWithShape: Incomplete
    scrgbClr: Incomplete
    srgbClr: Incomplete
    hslClr: Incomplete
    sysClr: Incomplete
    schemeClr: Incomplete
    prstClr: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        blurRad: Incomplete | None = None,
        dist: Incomplete | None = None,
        dir: Incomplete | None = None,
        sx: Incomplete | None = None,
        sy: Incomplete | None = None,
        kx: Incomplete | None = None,
        ky: Incomplete | None = None,
        algn: Incomplete | None = None,
        rotWithShape: Incomplete | None = None,
        **kw,
    ) -> None: ...

class PresetShadowEffect(ColorChoice):
    prst: Incomplete
    dist: Incomplete
    dir: Incomplete
    scrgbClr: Incomplete
    srgbClr: Incomplete
    hslClr: Incomplete
    sysClr: Incomplete
    schemeClr: Incomplete
    prstClr: Incomplete
    __elements__: Incomplete
    def __init__(
        self, prst: Incomplete | None = None, dist: Incomplete | None = None, dir: Incomplete | None = None, **kw
    ) -> None: ...

class ReflectionEffect(Serialisable):
    blurRad: Incomplete
    stA: Incomplete
    stPos: Incomplete
    endA: Incomplete
    endPos: Incomplete
    dist: Incomplete
    dir: Incomplete
    fadeDir: Incomplete
    sx: Incomplete
    sy: Incomplete
    kx: Incomplete
    ky: Incomplete
    algn: Incomplete
    rotWithShape: Incomplete
    def __init__(
        self,
        blurRad: Incomplete | None = None,
        stA: Incomplete | None = None,
        stPos: Incomplete | None = None,
        endA: Incomplete | None = None,
        endPos: Incomplete | None = None,
        dist: Incomplete | None = None,
        dir: Incomplete | None = None,
        fadeDir: Incomplete | None = None,
        sx: Incomplete | None = None,
        sy: Incomplete | None = None,
        kx: Incomplete | None = None,
        ky: Incomplete | None = None,
        algn: Incomplete | None = None,
        rotWithShape: Incomplete | None = None,
    ) -> None: ...

class SoftEdgesEffect(Serialisable):
    rad: Incomplete
    def __init__(self, rad: Incomplete | None = None) -> None: ...

class EffectList(Serialisable):
    blur: Incomplete
    fillOverlay: Incomplete
    glow: Incomplete
    innerShdw: Incomplete
    outerShdw: Incomplete
    prstShdw: Incomplete
    reflection: Incomplete
    softEdge: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        blur: Incomplete | None = None,
        fillOverlay: Incomplete | None = None,
        glow: Incomplete | None = None,
        innerShdw: Incomplete | None = None,
        outerShdw: Incomplete | None = None,
        prstShdw: Incomplete | None = None,
        reflection: Incomplete | None = None,
        softEdge: Incomplete | None = None,
    ) -> None: ...
