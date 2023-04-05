from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class _Protected:
    def set_password(self, value: str = "", already_hashed: bool = False) -> None: ...
    @property
    def password(self): ...
    @password.setter
    def password(self, value) -> None: ...

class SheetProtection(Serialisable, _Protected):
    tagname: str
    sheet: Incomplete
    enabled: Incomplete
    objects: Incomplete
    scenarios: Incomplete
    formatCells: Incomplete
    formatColumns: Incomplete
    formatRows: Incomplete
    insertColumns: Incomplete
    insertRows: Incomplete
    insertHyperlinks: Incomplete
    deleteColumns: Incomplete
    deleteRows: Incomplete
    selectLockedCells: Incomplete
    selectUnlockedCells: Incomplete
    sort: Incomplete
    autoFilter: Incomplete
    pivotTables: Incomplete
    saltValue: Incomplete
    spinCount: Incomplete
    algorithmName: Incomplete
    hashValue: Incomplete
    __attrs__: Incomplete
    password: Incomplete
    def __init__(
        self,
        sheet: bool = False,
        objects: bool = False,
        scenarios: bool = False,
        formatCells: bool = True,
        formatRows: bool = True,
        formatColumns: bool = True,
        insertColumns: bool = True,
        insertRows: bool = True,
        insertHyperlinks: bool = True,
        deleteColumns: bool = True,
        deleteRows: bool = True,
        selectLockedCells: bool = False,
        selectUnlockedCells: bool = False,
        sort: bool = True,
        autoFilter: bool = True,
        pivotTables: bool = True,
        password: Incomplete | None = None,
        algorithmName: Incomplete | None = None,
        saltValue: Incomplete | None = None,
        spinCount: Incomplete | None = None,
        hashValue: Incomplete | None = None,
    ) -> None: ...
    def set_password(self, value: str = "", already_hashed: bool = False) -> None: ...
    def enable(self) -> None: ...
    def disable(self) -> None: ...
    def __bool__(self) -> bool: ...
