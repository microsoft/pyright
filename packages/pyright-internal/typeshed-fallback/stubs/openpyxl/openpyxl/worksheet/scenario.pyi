from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class InputCells(Serialisable):
    tagname: str
    r: Incomplete
    deleted: Incomplete
    undone: Incomplete
    val: Incomplete
    numFmtId: Incomplete
    def __init__(
        self,
        r: Incomplete | None = None,
        deleted: bool = False,
        undone: bool = False,
        val: Incomplete | None = None,
        numFmtId: Incomplete | None = None,
    ) -> None: ...

class Scenario(Serialisable):
    tagname: str
    inputCells: Incomplete
    name: Incomplete
    locked: Incomplete
    hidden: Incomplete
    user: Incomplete
    comment: Incomplete
    __elements__: Incomplete
    __attrs__: Incomplete
    def __init__(
        self,
        inputCells=(),
        name: Incomplete | None = None,
        locked: bool = False,
        hidden: bool = False,
        count: Incomplete | None = None,
        user: Incomplete | None = None,
        comment: Incomplete | None = None,
    ) -> None: ...
    @property
    def count(self): ...

class ScenarioList(Serialisable):
    tagname: str
    scenario: Incomplete
    current: Incomplete
    show: Incomplete
    sqref: Incomplete
    __elements__: Incomplete
    def __init__(
        self, scenario=(), current: Incomplete | None = None, show: Incomplete | None = None, sqref: Incomplete | None = None
    ) -> None: ...
    def append(self, scenario) -> None: ...
    def __bool__(self) -> bool: ...
