from _typeshed import Incomplete
from collections import defaultdict
from collections.abc import Generator
from re import Pattern

from openpyxl.descriptors import Sequence
from openpyxl.descriptors.serialisable import Serialisable

RESERVED: frozenset[str]
RESERVED_REGEX: Pattern[str]

class DefinedName(Serialisable):
    tagname: str
    name: Incomplete
    comment: Incomplete
    customMenu: Incomplete
    description: Incomplete
    help: Incomplete
    statusBar: Incomplete
    localSheetId: Incomplete
    hidden: Incomplete
    function: Incomplete
    vbProcedure: Incomplete
    xlm: Incomplete
    functionGroupId: Incomplete
    shortcutKey: Incomplete
    publishToServer: Incomplete
    workbookParameter: Incomplete
    attr_text: Incomplete
    value: Incomplete
    def __init__(
        self,
        name: Incomplete | None = None,
        comment: Incomplete | None = None,
        customMenu: Incomplete | None = None,
        description: Incomplete | None = None,
        help: Incomplete | None = None,
        statusBar: Incomplete | None = None,
        localSheetId: Incomplete | None = None,
        hidden: Incomplete | None = None,
        function: Incomplete | None = None,
        vbProcedure: Incomplete | None = None,
        xlm: Incomplete | None = None,
        functionGroupId: Incomplete | None = None,
        shortcutKey: Incomplete | None = None,
        publishToServer: Incomplete | None = None,
        workbookParameter: Incomplete | None = None,
        attr_text: Incomplete | None = None,
    ) -> None: ...
    @property
    def type(self): ...
    @property
    def destinations(self) -> Generator[Incomplete, None, None]: ...
    @property
    def is_reserved(self): ...
    @property
    def is_external(self): ...
    def __iter__(self): ...

class DefinedNameDict(dict[str, DefinedName]):
    def add(self, value: DefinedName) -> None: ...

class DefinedNameList(Serialisable):
    tagname: str
    definedName: Sequence
    def __init__(self, definedName=()) -> None: ...
    def by_sheet(self) -> defaultdict[int, DefinedNameDict]: ...
    def __len__(self) -> int: ...
