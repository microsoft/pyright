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
        name: Incomplete | None = ...,
        comment: Incomplete | None = ...,
        customMenu: Incomplete | None = ...,
        description: Incomplete | None = ...,
        help: Incomplete | None = ...,
        statusBar: Incomplete | None = ...,
        localSheetId: Incomplete | None = ...,
        hidden: Incomplete | None = ...,
        function: Incomplete | None = ...,
        vbProcedure: Incomplete | None = ...,
        xlm: Incomplete | None = ...,
        functionGroupId: Incomplete | None = ...,
        shortcutKey: Incomplete | None = ...,
        publishToServer: Incomplete | None = ...,
        workbookParameter: Incomplete | None = ...,
        attr_text: Incomplete | None = ...,
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
    def __init__(self, definedName=...) -> None: ...
    def by_sheet(self) -> defaultdict[int, DefinedNameDict]: ...
    def __len__(self) -> int: ...
