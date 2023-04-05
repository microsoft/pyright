from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class Extension(Serialisable):
    tagname: str
    uri: Incomplete
    def __init__(self, uri: Incomplete | None = None) -> None: ...

class ExtensionList(Serialisable):
    tagname: str
    ext: Incomplete
    __elements__: Incomplete
    def __init__(self, ext=()) -> None: ...

class IgnoredError(Serialisable):
    tagname: str
    sqref: Incomplete
    evalError: Incomplete
    twoDigitTextYear: Incomplete
    numberStoredAsText: Incomplete
    formula: Incomplete
    formulaRange: Incomplete
    unlockedFormula: Incomplete
    emptyCellReference: Incomplete
    listDataValidation: Incomplete
    calculatedColumn: Incomplete
    def __init__(
        self,
        sqref: Incomplete | None = None,
        evalError: bool = False,
        twoDigitTextYear: bool = False,
        numberStoredAsText: bool = False,
        formula: bool = False,
        formulaRange: bool = False,
        unlockedFormula: bool = False,
        emptyCellReference: bool = False,
        listDataValidation: bool = False,
        calculatedColumn: bool = False,
    ) -> None: ...

class IgnoredErrors(Serialisable):
    tagname: str
    ignoredError: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(self, ignoredError=(), extLst: Incomplete | None = None) -> None: ...
