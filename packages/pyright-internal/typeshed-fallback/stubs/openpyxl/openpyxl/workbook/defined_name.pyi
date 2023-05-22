from _typeshed import Incomplete
from collections import defaultdict
from collections.abc import Generator
from re import Pattern
from typing_extensions import Literal

from openpyxl.descriptors import Sequence
from openpyxl.descriptors.base import Alias, Bool, Integer, String, _ConvertibleToBool, _ConvertibleToInt
from openpyxl.descriptors.serialisable import Serialisable

RESERVED: frozenset[str]
RESERVED_REGEX: Pattern[str]

class DefinedName(Serialisable):
    tagname: str
    name: String[Literal[False]]
    comment: String[Literal[True]]
    customMenu: String[Literal[True]]
    description: String[Literal[True]]
    help: String[Literal[True]]
    statusBar: String[Literal[True]]
    localSheetId: Integer[Literal[True]]
    hidden: Bool[Literal[True]]
    function: Bool[Literal[True]]
    vbProcedure: Bool[Literal[True]]
    xlm: Bool[Literal[True]]
    functionGroupId: Integer[Literal[True]]
    shortcutKey: String[Literal[True]]
    publishToServer: Bool[Literal[True]]
    workbookParameter: Bool[Literal[True]]
    attr_text: Incomplete
    value: Alias
    def __init__(
        self,
        name: str,
        comment: str | None = None,
        customMenu: str | None = None,
        description: str | None = None,
        help: str | None = None,
        statusBar: str | None = None,
        localSheetId: _ConvertibleToInt | None = None,
        hidden: _ConvertibleToBool | None = None,
        function: _ConvertibleToBool | None = None,
        vbProcedure: _ConvertibleToBool | None = None,
        xlm: _ConvertibleToBool | None = None,
        functionGroupId: _ConvertibleToInt | None = None,
        shortcutKey: str | None = None,
        publishToServer: _ConvertibleToBool | None = None,
        workbookParameter: _ConvertibleToBool | None = None,
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
