from _typeshed import Incomplete

from openpyxl.descriptors import Typed
from openpyxl.descriptors.serialisable import Serialisable

PRESET_COLORS: Incomplete
SCHEME_COLORS: Incomplete

class Transform(Serialisable): ...

class SystemColor(Serialisable):
    tagname: str
    namespace: Incomplete
    tint: Incomplete
    shade: Incomplete
    comp: Incomplete
    inv: Incomplete
    gray: Incomplete
    alpha: Incomplete
    alphaOff: Incomplete
    alphaMod: Incomplete
    hue: Incomplete
    hueOff: Incomplete
    hueMod: Incomplete
    sat: Incomplete
    satOff: Incomplete
    satMod: Incomplete
    lum: Incomplete
    lumOff: Incomplete
    lumMod: Incomplete
    red: Incomplete
    redOff: Incomplete
    redMod: Incomplete
    green: Incomplete
    greenOff: Incomplete
    greenMod: Incomplete
    blue: Incomplete
    blueOff: Incomplete
    blueMod: Incomplete
    gamma: Incomplete
    invGamma: Incomplete
    val: Incomplete
    lastClr: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        val: str = "windowText",
        lastClr: Incomplete | None = None,
        tint: Incomplete | None = None,
        shade: Incomplete | None = None,
        comp: Incomplete | None = None,
        inv: Incomplete | None = None,
        gray: Incomplete | None = None,
        alpha: Incomplete | None = None,
        alphaOff: Incomplete | None = None,
        alphaMod: Incomplete | None = None,
        hue: Incomplete | None = None,
        hueOff: Incomplete | None = None,
        hueMod: Incomplete | None = None,
        sat: Incomplete | None = None,
        satOff: Incomplete | None = None,
        satMod: Incomplete | None = None,
        lum: Incomplete | None = None,
        lumOff: Incomplete | None = None,
        lumMod: Incomplete | None = None,
        red: Incomplete | None = None,
        redOff: Incomplete | None = None,
        redMod: Incomplete | None = None,
        green: Incomplete | None = None,
        greenOff: Incomplete | None = None,
        greenMod: Incomplete | None = None,
        blue: Incomplete | None = None,
        blueOff: Incomplete | None = None,
        blueMod: Incomplete | None = None,
        gamma: Incomplete | None = None,
        invGamma: Incomplete | None = None,
    ) -> None: ...

class HSLColor(Serialisable):
    tagname: str
    hue: Incomplete
    sat: Incomplete
    lum: Incomplete
    def __init__(self, hue: Incomplete | None = None, sat: Incomplete | None = None, lum: Incomplete | None = None) -> None: ...

class RGBPercent(Serialisable):
    tagname: str
    r: Incomplete
    g: Incomplete
    b: Incomplete
    def __init__(self, r: Incomplete | None = None, g: Incomplete | None = None, b: Incomplete | None = None) -> None: ...

class SchemeColor(Serialisable):
    tagname: str
    namespace: Incomplete
    tint: Incomplete
    shade: Incomplete
    comp: Incomplete
    inv: Incomplete
    gray: Incomplete
    alpha: Incomplete
    alphaOff: Incomplete
    alphaMod: Incomplete
    hue: Incomplete
    hueOff: Incomplete
    hueMod: Incomplete
    sat: Incomplete
    satOff: Incomplete
    satMod: Incomplete
    lum: Incomplete
    lumOff: Incomplete
    lumMod: Incomplete
    red: Incomplete
    redOff: Incomplete
    redMod: Incomplete
    green: Incomplete
    greenOff: Incomplete
    greenMod: Incomplete
    blue: Incomplete
    blueOff: Incomplete
    blueMod: Incomplete
    gamma: Incomplete
    invGamma: Incomplete
    val: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        tint: Incomplete | None = None,
        shade: Incomplete | None = None,
        comp: Incomplete | None = None,
        inv: Incomplete | None = None,
        gray: Incomplete | None = None,
        alpha: Incomplete | None = None,
        alphaOff: Incomplete | None = None,
        alphaMod: Incomplete | None = None,
        hue: Incomplete | None = None,
        hueOff: Incomplete | None = None,
        hueMod: Incomplete | None = None,
        sat: Incomplete | None = None,
        satOff: Incomplete | None = None,
        satMod: Incomplete | None = None,
        lum: Incomplete | None = None,
        lumOff: Incomplete | None = None,
        lumMod: Incomplete | None = None,
        red: Incomplete | None = None,
        redOff: Incomplete | None = None,
        redMod: Incomplete | None = None,
        green: Incomplete | None = None,
        greenOff: Incomplete | None = None,
        greenMod: Incomplete | None = None,
        blue: Incomplete | None = None,
        blueOff: Incomplete | None = None,
        blueMod: Incomplete | None = None,
        gamma: Incomplete | None = None,
        invGamma: Incomplete | None = None,
        val: Incomplete | None = None,
    ) -> None: ...

class ColorChoice(Serialisable):
    tagname: str
    namespace: Incomplete
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

class ColorMapping(Serialisable):
    tagname: str
    bg1: Incomplete
    tx1: Incomplete
    bg2: Incomplete
    tx2: Incomplete
    accent1: Incomplete
    accent2: Incomplete
    accent3: Incomplete
    accent4: Incomplete
    accent5: Incomplete
    accent6: Incomplete
    hlink: Incomplete
    folHlink: Incomplete
    extLst: Incomplete
    def __init__(
        self,
        bg1: str = "lt1",
        tx1: str = "dk1",
        bg2: str = "lt2",
        tx2: str = "dk2",
        accent1: str = "accent1",
        accent2: str = "accent2",
        accent3: str = "accent3",
        accent4: str = "accent4",
        accent5: str = "accent5",
        accent6: str = "accent6",
        hlink: str = "hlink",
        folHlink: str = "folHlink",
        extLst: Incomplete | None = None,
    ) -> None: ...

class ColorChoiceDescriptor(Typed):
    expected_type: Incomplete
    allow_none: bool
    def __set__(self, instance, value) -> None: ...
