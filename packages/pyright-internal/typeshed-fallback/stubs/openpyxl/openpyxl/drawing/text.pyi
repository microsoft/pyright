from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class EmbeddedWAVAudioFile(Serialisable):  # type: ignore[misc]
    name: Incomplete
    def __init__(self, name: Incomplete | None = None) -> None: ...

class Hyperlink(Serialisable):
    tagname: str
    namespace: Incomplete
    invalidUrl: Incomplete
    action: Incomplete
    tgtFrame: Incomplete
    tooltip: Incomplete
    history: Incomplete
    highlightClick: Incomplete
    endSnd: Incomplete
    snd: Incomplete
    extLst: Incomplete
    id: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        invalidUrl: Incomplete | None = None,
        action: Incomplete | None = None,
        tgtFrame: Incomplete | None = None,
        tooltip: Incomplete | None = None,
        history: Incomplete | None = None,
        highlightClick: Incomplete | None = None,
        endSnd: Incomplete | None = None,
        snd: Incomplete | None = None,
        extLst: Incomplete | None = None,
        id: Incomplete | None = None,
    ) -> None: ...

class Font(Serialisable):
    tagname: str
    namespace: Incomplete
    typeface: Incomplete
    panose: Incomplete
    pitchFamily: Incomplete
    charset: Incomplete
    def __init__(
        self,
        typeface: Incomplete | None = None,
        panose: Incomplete | None = None,
        pitchFamily: Incomplete | None = None,
        charset: Incomplete | None = None,
    ) -> None: ...

class CharacterProperties(Serialisable):
    tagname: str
    namespace: Incomplete
    kumimoji: Incomplete
    lang: Incomplete
    altLang: Incomplete
    sz: Incomplete
    b: Incomplete
    i: Incomplete
    u: Incomplete
    strike: Incomplete
    kern: Incomplete
    cap: Incomplete
    spc: Incomplete
    normalizeH: Incomplete
    baseline: Incomplete
    noProof: Incomplete
    dirty: Incomplete
    err: Incomplete
    smtClean: Incomplete
    smtId: Incomplete
    bmk: Incomplete
    ln: Incomplete
    highlight: Incomplete
    latin: Incomplete
    ea: Incomplete
    cs: Incomplete
    sym: Incomplete
    hlinkClick: Incomplete
    hlinkMouseOver: Incomplete
    rtl: Incomplete
    extLst: Incomplete
    noFill: Incomplete
    solidFill: Incomplete
    gradFill: Incomplete
    blipFill: Incomplete
    pattFill: Incomplete
    grpFill: Incomplete
    effectLst: Incomplete
    effectDag: Incomplete
    uLnTx: Incomplete
    uLn: Incomplete
    uFillTx: Incomplete
    uFill: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        kumimoji: Incomplete | None = None,
        lang: Incomplete | None = None,
        altLang: Incomplete | None = None,
        sz: Incomplete | None = None,
        b: Incomplete | None = None,
        i: Incomplete | None = None,
        u: Incomplete | None = None,
        strike: Incomplete | None = None,
        kern: Incomplete | None = None,
        cap: Incomplete | None = None,
        spc: Incomplete | None = None,
        normalizeH: Incomplete | None = None,
        baseline: Incomplete | None = None,
        noProof: Incomplete | None = None,
        dirty: Incomplete | None = None,
        err: Incomplete | None = None,
        smtClean: Incomplete | None = None,
        smtId: Incomplete | None = None,
        bmk: Incomplete | None = None,
        ln: Incomplete | None = None,
        highlight: Incomplete | None = None,
        latin: Incomplete | None = None,
        ea: Incomplete | None = None,
        cs: Incomplete | None = None,
        sym: Incomplete | None = None,
        hlinkClick: Incomplete | None = None,
        hlinkMouseOver: Incomplete | None = None,
        rtl: Incomplete | None = None,
        extLst: Incomplete | None = None,
        noFill: Incomplete | None = None,
        solidFill: Incomplete | None = None,
        gradFill: Incomplete | None = None,
        blipFill: Incomplete | None = None,
        pattFill: Incomplete | None = None,
        grpFill: Incomplete | None = None,
        effectLst: Incomplete | None = None,
        effectDag: Incomplete | None = None,
        uLnTx: Incomplete | None = None,
        uLn: Incomplete | None = None,
        uFillTx: Incomplete | None = None,
        uFill: Incomplete | None = None,
    ) -> None: ...

class TabStop(Serialisable):  # type: ignore[misc]
    pos: Incomplete
    algn: Incomplete
    def __init__(self, pos: Incomplete | None = None, algn: Incomplete | None = None) -> None: ...

class TabStopList(Serialisable):  # type: ignore[misc]
    tab: Incomplete
    def __init__(self, tab: Incomplete | None = None) -> None: ...

class Spacing(Serialisable):
    spcPct: Incomplete
    spcPts: Incomplete
    __elements__: Incomplete
    def __init__(self, spcPct: Incomplete | None = None, spcPts: Incomplete | None = None) -> None: ...

class AutonumberBullet(Serialisable):
    type: Incomplete
    startAt: Incomplete
    def __init__(self, type: Incomplete | None = None, startAt: Incomplete | None = None) -> None: ...

class ParagraphProperties(Serialisable):
    tagname: str
    namespace: Incomplete
    marL: Incomplete
    marR: Incomplete
    lvl: Incomplete
    indent: Incomplete
    algn: Incomplete
    defTabSz: Incomplete
    rtl: Incomplete
    eaLnBrk: Incomplete
    fontAlgn: Incomplete
    latinLnBrk: Incomplete
    hangingPunct: Incomplete
    lnSpc: Incomplete
    spcBef: Incomplete
    spcAft: Incomplete
    tabLst: Incomplete
    defRPr: Incomplete
    extLst: Incomplete
    buClrTx: Incomplete
    buClr: Incomplete
    buSzTx: Incomplete
    buSzPct: Incomplete
    buSzPts: Incomplete
    buFontTx: Incomplete
    buFont: Incomplete
    buNone: Incomplete
    buAutoNum: Incomplete
    buChar: Incomplete
    buBlip: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        marL: Incomplete | None = None,
        marR: Incomplete | None = None,
        lvl: Incomplete | None = None,
        indent: Incomplete | None = None,
        algn: Incomplete | None = None,
        defTabSz: Incomplete | None = None,
        rtl: Incomplete | None = None,
        eaLnBrk: Incomplete | None = None,
        fontAlgn: Incomplete | None = None,
        latinLnBrk: Incomplete | None = None,
        hangingPunct: Incomplete | None = None,
        lnSpc: Incomplete | None = None,
        spcBef: Incomplete | None = None,
        spcAft: Incomplete | None = None,
        tabLst: Incomplete | None = None,
        defRPr: Incomplete | None = None,
        extLst: Incomplete | None = None,
        buClrTx: Incomplete | None = None,
        buClr: Incomplete | None = None,
        buSzTx: Incomplete | None = None,
        buSzPct: Incomplete | None = None,
        buSzPts: Incomplete | None = None,
        buFontTx: Incomplete | None = None,
        buFont: Incomplete | None = None,
        buNone: Incomplete | None = None,
        buAutoNum: Incomplete | None = None,
        buChar: Incomplete | None = None,
        buBlip: Incomplete | None = None,
    ) -> None: ...

class ListStyle(Serialisable):
    tagname: str
    namespace: Incomplete
    defPPr: Incomplete
    lvl1pPr: Incomplete
    lvl2pPr: Incomplete
    lvl3pPr: Incomplete
    lvl4pPr: Incomplete
    lvl5pPr: Incomplete
    lvl6pPr: Incomplete
    lvl7pPr: Incomplete
    lvl8pPr: Incomplete
    lvl9pPr: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        defPPr: Incomplete | None = None,
        lvl1pPr: Incomplete | None = None,
        lvl2pPr: Incomplete | None = None,
        lvl3pPr: Incomplete | None = None,
        lvl4pPr: Incomplete | None = None,
        lvl5pPr: Incomplete | None = None,
        lvl6pPr: Incomplete | None = None,
        lvl7pPr: Incomplete | None = None,
        lvl8pPr: Incomplete | None = None,
        lvl9pPr: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class RegularTextRun(Serialisable):
    tagname: str
    namespace: Incomplete
    rPr: Incomplete
    properties: Incomplete
    t: Incomplete
    value: Incomplete
    __elements__: Incomplete
    def __init__(self, rPr: Incomplete | None = None, t: str = "") -> None: ...

class LineBreak(Serialisable):
    tagname: str
    namespace: Incomplete
    rPr: Incomplete
    __elements__: Incomplete
    def __init__(self, rPr: Incomplete | None = None) -> None: ...

class TextField(Serialisable):
    id: Incomplete
    type: Incomplete
    rPr: Incomplete
    pPr: Incomplete
    t: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        id: Incomplete | None = None,
        type: Incomplete | None = None,
        rPr: Incomplete | None = None,
        pPr: Incomplete | None = None,
        t: Incomplete | None = None,
    ) -> None: ...

class Paragraph(Serialisable):
    tagname: str
    namespace: Incomplete
    pPr: Incomplete
    properties: Incomplete
    endParaRPr: Incomplete
    r: Incomplete
    text: Incomplete
    br: Incomplete
    fld: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        pPr: Incomplete | None = None,
        endParaRPr: Incomplete | None = None,
        r: Incomplete | None = None,
        br: Incomplete | None = None,
        fld: Incomplete | None = None,
    ) -> None: ...

class GeomGuide(Serialisable):
    name: Incomplete
    fmla: Incomplete
    def __init__(self, name: Incomplete | None = None, fmla: Incomplete | None = None) -> None: ...

class GeomGuideList(Serialisable):
    gd: Incomplete
    def __init__(self, gd: Incomplete | None = None) -> None: ...

class PresetTextShape(Serialisable):
    prst: Incomplete
    avLst: Incomplete
    def __init__(self, prst: Incomplete | None = None, avLst: Incomplete | None = None) -> None: ...

class TextNormalAutofit(Serialisable):
    fontScale: Incomplete
    lnSpcReduction: Incomplete
    def __init__(self, fontScale: Incomplete | None = None, lnSpcReduction: Incomplete | None = None) -> None: ...

class RichTextProperties(Serialisable):
    tagname: str
    namespace: Incomplete
    rot: Incomplete
    spcFirstLastPara: Incomplete
    vertOverflow: Incomplete
    horzOverflow: Incomplete
    vert: Incomplete
    wrap: Incomplete
    lIns: Incomplete
    tIns: Incomplete
    rIns: Incomplete
    bIns: Incomplete
    numCol: Incomplete
    spcCol: Incomplete
    rtlCol: Incomplete
    fromWordArt: Incomplete
    anchor: Incomplete
    anchorCtr: Incomplete
    forceAA: Incomplete
    upright: Incomplete
    compatLnSpc: Incomplete
    prstTxWarp: Incomplete
    scene3d: Incomplete
    extLst: Incomplete
    noAutofit: Incomplete
    normAutofit: Incomplete
    spAutoFit: Incomplete
    flatTx: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        rot: Incomplete | None = None,
        spcFirstLastPara: Incomplete | None = None,
        vertOverflow: Incomplete | None = None,
        horzOverflow: Incomplete | None = None,
        vert: Incomplete | None = None,
        wrap: Incomplete | None = None,
        lIns: Incomplete | None = None,
        tIns: Incomplete | None = None,
        rIns: Incomplete | None = None,
        bIns: Incomplete | None = None,
        numCol: Incomplete | None = None,
        spcCol: Incomplete | None = None,
        rtlCol: Incomplete | None = None,
        fromWordArt: Incomplete | None = None,
        anchor: Incomplete | None = None,
        anchorCtr: Incomplete | None = None,
        forceAA: Incomplete | None = None,
        upright: Incomplete | None = None,
        compatLnSpc: Incomplete | None = None,
        prstTxWarp: Incomplete | None = None,
        scene3d: Incomplete | None = None,
        extLst: Incomplete | None = None,
        noAutofit: Incomplete | None = None,
        normAutofit: Incomplete | None = None,
        spAutoFit: Incomplete | None = None,
        flatTx: Incomplete | None = None,
    ) -> None: ...
