from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class NamedStyle(Serialisable):  # type: ignore[misc]
    font: Incomplete
    fill: Incomplete
    border: Incomplete
    alignment: Incomplete
    number_format: Incomplete
    protection: Incomplete
    builtinId: Incomplete
    hidden: Incomplete
    # Overwritten by property below
    # xfId: Integer
    name: Incomplete
    def __init__(
        self,
        name: str = "Normal",
        font=None,
        fill=None,
        border=None,
        alignment=None,
        number_format: Incomplete | None = None,
        protection=None,
        builtinId: Incomplete | None = None,
        hidden: bool = False,
        xfId: Incomplete | None = None,
    ) -> None: ...
    def __setattr__(self, attr: str, value) -> None: ...
    def __iter__(self): ...
    @property
    def xfId(self): ...
    def bind(self, wb) -> None: ...
    def as_tuple(self): ...
    def as_xf(self): ...
    def as_name(self): ...

class NamedStyleList(list[Incomplete]):
    @property
    def names(self): ...
    def __getitem__(self, key): ...
    def append(self, style) -> None: ...

class _NamedCellStyle(Serialisable):
    tagname: str
    name: Incomplete
    xfId: Incomplete
    builtinId: Incomplete
    iLevel: Incomplete
    hidden: Incomplete
    customBuiltin: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        name: Incomplete | None = None,
        xfId: Incomplete | None = None,
        builtinId: Incomplete | None = None,
        iLevel: Incomplete | None = None,
        hidden: Incomplete | None = None,
        customBuiltin: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class _NamedCellStyleList(Serialisable):
    tagname: str
    # Overwritten by property below
    # count: Integer
    cellStyle: Incomplete
    __attrs__: Incomplete
    def __init__(self, count: Incomplete | None = None, cellStyle=()) -> None: ...
    @property
    def count(self): ...
    @property
    def names(self): ...
