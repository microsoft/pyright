from _typeshed import Incomplete
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.descriptors.base import Alias, Bool, Integer, String, _ConvertibleToBool, _ConvertibleToInt
from openpyxl.descriptors.serialisable import Serialisable

class _Protected:
    def set_password(self, value: str = "", already_hashed: bool = False) -> None: ...
    @property
    def password(self): ...
    @password.setter
    def password(self, value) -> None: ...

class SheetProtection(Serialisable, _Protected):
    tagname: str
    sheet: Bool[Literal[False]]
    enabled: Alias
    objects: Bool[Literal[False]]
    scenarios: Bool[Literal[False]]
    formatCells: Bool[Literal[False]]
    formatColumns: Bool[Literal[False]]
    formatRows: Bool[Literal[False]]
    insertColumns: Bool[Literal[False]]
    insertRows: Bool[Literal[False]]
    insertHyperlinks: Bool[Literal[False]]
    deleteColumns: Bool[Literal[False]]
    deleteRows: Bool[Literal[False]]
    selectLockedCells: Bool[Literal[False]]
    selectUnlockedCells: Bool[Literal[False]]
    sort: Bool[Literal[False]]
    autoFilter: Bool[Literal[False]]
    pivotTables: Bool[Literal[False]]
    saltValue: Incomplete
    spinCount: Integer[Literal[True]]
    algorithmName: String[Literal[True]]
    hashValue: Incomplete
    __attrs__: ClassVar[tuple[str, ...]]
    password: Incomplete
    def __init__(
        self,
        sheet: _ConvertibleToBool = False,
        objects: _ConvertibleToBool = False,
        scenarios: _ConvertibleToBool = False,
        formatCells: _ConvertibleToBool = True,
        formatRows: _ConvertibleToBool = True,
        formatColumns: _ConvertibleToBool = True,
        insertColumns: _ConvertibleToBool = True,
        insertRows: _ConvertibleToBool = True,
        insertHyperlinks: _ConvertibleToBool = True,
        deleteColumns: _ConvertibleToBool = True,
        deleteRows: _ConvertibleToBool = True,
        selectLockedCells: _ConvertibleToBool = False,
        selectUnlockedCells: _ConvertibleToBool = False,
        sort: _ConvertibleToBool = True,
        autoFilter: _ConvertibleToBool = True,
        pivotTables: _ConvertibleToBool = True,
        password: Incomplete | None = None,
        algorithmName: str | None = None,
        saltValue: Incomplete | None = None,
        spinCount: _ConvertibleToInt | None = None,
        hashValue: Incomplete | None = None,
    ) -> None: ...
    def set_password(self, value: str = "", already_hashed: bool = False) -> None: ...
    def enable(self) -> None: ...
    def disable(self) -> None: ...
    def __bool__(self) -> bool: ...
