from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class LineEndProperties(Serialisable):
    tagname: str
    namespace: Incomplete
    type: Incomplete
    w: Incomplete
    len: Incomplete
    def __init__(self, type: Incomplete | None = None, w: Incomplete | None = None, len: Incomplete | None = None) -> None: ...

class DashStop(Serialisable):
    tagname: str
    namespace: Incomplete
    d: Incomplete
    length: Incomplete
    sp: Incomplete
    space: Incomplete
    def __init__(self, d: int = 0, sp: int = 0) -> None: ...

class DashStopList(Serialisable):
    ds: Incomplete
    def __init__(self, ds: Incomplete | None = None) -> None: ...

class LineProperties(Serialisable):
    tagname: str
    namespace: Incomplete
    w: Incomplete
    width: Incomplete
    cap: Incomplete
    cmpd: Incomplete
    algn: Incomplete
    noFill: Incomplete
    solidFill: Incomplete
    gradFill: Incomplete
    pattFill: Incomplete
    prstDash: Incomplete
    dashStyle: Incomplete
    custDash: Incomplete
    round: Incomplete
    bevel: Incomplete
    miter: Incomplete
    headEnd: Incomplete
    tailEnd: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        w: Incomplete | None = None,
        cap: Incomplete | None = None,
        cmpd: Incomplete | None = None,
        algn: Incomplete | None = None,
        noFill: Incomplete | None = None,
        solidFill: Incomplete | None = None,
        gradFill: Incomplete | None = None,
        pattFill: Incomplete | None = None,
        prstDash: Incomplete | None = None,
        custDash: Incomplete | None = None,
        round: Incomplete | None = None,
        bevel: Incomplete | None = None,
        miter: Incomplete | None = None,
        headEnd: Incomplete | None = None,
        tailEnd: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...
