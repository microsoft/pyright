from _typeshed import Incomplete
from typing import ClassVar, overload
from typing_extensions import Literal, TypeAlias

from openpyxl.descriptors import Strict, Typed
from openpyxl.descriptors.base import Alias, Integer, MinMax, Set, _ConvertibleToFloat, _ConvertibleToInt
from openpyxl.descriptors.excel import ExtensionList
from openpyxl.descriptors.serialisable import Serialisable

_ColorSetType: TypeAlias = Literal[
    "dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"
]
_SystemColorVal: TypeAlias = Literal[
    "scrollBar",
    "background",
    "activeCaption",
    "inactiveCaption",
    "menu",
    "window",
    "windowFrame",
    "menuText",
    "windowText",
    "captionText",
    "activeBorder",
    "inactiveBorder",
    "appWorkspace",
    "highlight",
    "highlightText",
    "btnFace",
    "btnShadow",
    "grayText",
    "btnText",
    "inactiveCaptionText",
    "btnHighlight",
    "3dDkShadow",
    "3dLight",
    "infoText",
    "infoBk",
    "hotLight",
    "gradientActiveCaption",
    "gradientInactiveCaption",
    "menuHighlight",
    "menuBar",
]
_SchemeColorVal: TypeAlias = Literal[
    "bg1",
    "tx1",
    "bg2",
    "tx2",
    "accent1",
    "accent2",
    "accent3",
    "accent4",
    "accent5",
    "accent6",
    "hlink",
    "folHlink",
    "phClr",
    "dk1",
    "lt1",
    "dk2",
    "lt2",
]

PRESET_COLORS: Incomplete
SCHEME_COLORS: Incomplete

class Transform(Serialisable): ...

class SystemColor(Serialisable):
    tagname: str
    namespace: Incomplete
    tint: Incomplete
    shade: Incomplete
    comp: Typed[Transform, Literal[True]]
    inv: Typed[Transform, Literal[True]]
    gray: Typed[Transform, Literal[True]]
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
    gamma: Typed[Transform, Literal[True]]
    invGamma: Typed[Transform, Literal[True]]
    val: Set[_SystemColorVal]
    lastClr: Incomplete
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        val: _SystemColorVal = "windowText",
        lastClr: Incomplete | None = None,
        tint: Incomplete | None = None,
        shade: Incomplete | None = None,
        comp: Transform | None = None,
        inv: Transform | None = None,
        gray: Transform | None = None,
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
        gamma: Transform | None = None,
        invGamma: Transform | None = None,
    ) -> None: ...

class HSLColor(Serialisable):
    tagname: str
    hue: Integer[Literal[False]]
    sat: MinMax[float, Literal[False]]
    lum: MinMax[float, Literal[False]]
    def __init__(self, hue: _ConvertibleToInt, sat: _ConvertibleToFloat, lum: _ConvertibleToFloat) -> None: ...

class RGBPercent(Serialisable):
    tagname: str
    r: MinMax[float, Literal[False]]
    g: MinMax[float, Literal[False]]
    b: MinMax[float, Literal[False]]
    def __init__(self, r: _ConvertibleToFloat, g: _ConvertibleToFloat, b: _ConvertibleToFloat) -> None: ...

_RGBPercent: TypeAlias = RGBPercent

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
    val: Set[_SchemeColorVal]
    __elements__: ClassVar[tuple[str, ...]]
    @overload
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
        *,
        val: _SchemeColorVal,
    ) -> None: ...
    @overload
    def __init__(
        self,
        tint: Incomplete | None,
        shade: Incomplete | None,
        comp: Incomplete | None,
        inv: Incomplete | None,
        gray: Incomplete | None,
        alpha: Incomplete | None,
        alphaOff: Incomplete | None,
        alphaMod: Incomplete | None,
        hue: Incomplete | None,
        hueOff: Incomplete | None,
        hueMod: Incomplete | None,
        sat: Incomplete | None,
        satOff: Incomplete | None,
        satMod: Incomplete | None,
        lum: Incomplete | None,
        lumOff: Incomplete | None,
        lumMod: Incomplete | None,
        red: Incomplete | None,
        redOff: Incomplete | None,
        redMod: Incomplete | None,
        green: Incomplete | None,
        greenOff: Incomplete | None,
        greenMod: Incomplete | None,
        blue: Incomplete | None,
        blueOff: Incomplete | None,
        blueMod: Incomplete | None,
        gamma: Incomplete | None,
        invGamma: Incomplete | None,
        val: _SchemeColorVal,
    ) -> None: ...

class ColorChoice(Serialisable):
    tagname: str
    namespace: Incomplete
    scrgbClr: Typed[_RGBPercent, Literal[True]]
    RGBPercent: Alias
    srgbClr: Incomplete
    RGB: Alias
    hslClr: Typed[HSLColor, Literal[True]]
    sysClr: Typed[SystemColor, Literal[True]]
    schemeClr: Typed[SystemColor, Literal[True]]
    prstClr: Incomplete
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        scrgbClr: _RGBPercent | None = None,
        srgbClr: Incomplete | None = None,
        hslClr: HSLColor | None = None,
        sysClr: SystemColor | None = None,
        schemeClr: SystemColor | None = None,
        prstClr: Incomplete | None = None,
    ) -> None: ...

_COLOR_SET: tuple[_ColorSetType, ...]

class ColorMapping(Serialisable):
    tagname: str
    bg1: Set[_ColorSetType]
    tx1: Set[_ColorSetType]
    bg2: Set[_ColorSetType]
    tx2: Set[_ColorSetType]
    accent1: Set[_ColorSetType]
    accent2: Set[_ColorSetType]
    accent3: Set[_ColorSetType]
    accent4: Set[_ColorSetType]
    accent5: Set[_ColorSetType]
    accent6: Set[_ColorSetType]
    hlink: Set[_ColorSetType]
    folHlink: Set[_ColorSetType]
    extLst: Typed[ExtensionList, Literal[True]]
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
        extLst: ExtensionList | None = None,
    ) -> None: ...

class ColorChoiceDescriptor(Typed[ColorChoice, Incomplete]):
    expected_type: type[ColorChoice]
    allow_none: Literal[True]
    def __set__(self, instance: Serialisable | Strict, value) -> None: ...
