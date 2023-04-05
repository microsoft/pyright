from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class SheetBackgroundPicture(Serialisable):
    tagname: str
    id: Incomplete
    def __init__(self, id) -> None: ...

class DrawingHF(Serialisable):
    id: Incomplete
    lho: Incomplete
    leftHeaderOddPages: Incomplete
    lhe: Incomplete
    leftHeaderEvenPages: Incomplete
    lhf: Incomplete
    leftHeaderFirstPage: Incomplete
    cho: Incomplete
    centerHeaderOddPages: Incomplete
    che: Incomplete
    centerHeaderEvenPages: Incomplete
    chf: Incomplete
    centerHeaderFirstPage: Incomplete
    rho: Incomplete
    rightHeaderOddPages: Incomplete
    rhe: Incomplete
    rightHeaderEvenPages: Incomplete
    rhf: Incomplete
    rightHeaderFirstPage: Incomplete
    lfo: Incomplete
    leftFooterOddPages: Incomplete
    lfe: Incomplete
    leftFooterEvenPages: Incomplete
    lff: Incomplete
    leftFooterFirstPage: Incomplete
    cfo: Incomplete
    centerFooterOddPages: Incomplete
    cfe: Incomplete
    centerFooterEvenPages: Incomplete
    cff: Incomplete
    centerFooterFirstPage: Incomplete
    rfo: Incomplete
    rightFooterOddPages: Incomplete
    rfe: Incomplete
    rightFooterEvenPages: Incomplete
    rff: Incomplete
    rightFooterFirstPage: Incomplete
    def __init__(
        self,
        id: Incomplete | None = None,
        lho: Incomplete | None = None,
        lhe: Incomplete | None = None,
        lhf: Incomplete | None = None,
        cho: Incomplete | None = None,
        che: Incomplete | None = None,
        chf: Incomplete | None = None,
        rho: Incomplete | None = None,
        rhe: Incomplete | None = None,
        rhf: Incomplete | None = None,
        lfo: Incomplete | None = None,
        lfe: Incomplete | None = None,
        lff: Incomplete | None = None,
        cfo: Incomplete | None = None,
        cfe: Incomplete | None = None,
        cff: Incomplete | None = None,
        rfo: Incomplete | None = None,
        rfe: Incomplete | None = None,
        rff: Incomplete | None = None,
    ) -> None: ...
