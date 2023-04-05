from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class Outline(Serialisable):
    tagname: str
    applyStyles: Incomplete
    summaryBelow: Incomplete
    summaryRight: Incomplete
    showOutlineSymbols: Incomplete
    def __init__(
        self,
        applyStyles: Incomplete | None = None,
        summaryBelow: Incomplete | None = None,
        summaryRight: Incomplete | None = None,
        showOutlineSymbols: Incomplete | None = None,
    ) -> None: ...

class PageSetupProperties(Serialisable):
    tagname: str
    autoPageBreaks: Incomplete
    fitToPage: Incomplete
    def __init__(self, autoPageBreaks: Incomplete | None = None, fitToPage: Incomplete | None = None) -> None: ...

class WorksheetProperties(Serialisable):
    tagname: str
    codeName: Incomplete
    enableFormatConditionsCalculation: Incomplete
    filterMode: Incomplete
    published: Incomplete
    syncHorizontal: Incomplete
    syncRef: Incomplete
    syncVertical: Incomplete
    transitionEvaluation: Incomplete
    transitionEntry: Incomplete
    tabColor: Incomplete
    outlinePr: Incomplete
    pageSetUpPr: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        codeName: Incomplete | None = None,
        enableFormatConditionsCalculation: Incomplete | None = None,
        filterMode: Incomplete | None = None,
        published: Incomplete | None = None,
        syncHorizontal: Incomplete | None = None,
        syncRef: Incomplete | None = None,
        syncVertical: Incomplete | None = None,
        transitionEvaluation: Incomplete | None = None,
        transitionEntry: Incomplete | None = None,
        tabColor: Incomplete | None = None,
        outlinePr: Incomplete | None = None,
        pageSetUpPr: Incomplete | None = None,
    ) -> None: ...
