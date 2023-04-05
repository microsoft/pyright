from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class Hyperlink(Serialisable):
    tagname: str
    ref: Incomplete
    location: Incomplete
    tooltip: Incomplete
    display: Incomplete
    id: Incomplete
    target: Incomplete
    __attrs__: Incomplete
    def __init__(
        self,
        ref: Incomplete | None = None,
        location: Incomplete | None = None,
        tooltip: Incomplete | None = None,
        display: Incomplete | None = None,
        id: Incomplete | None = None,
        target: Incomplete | None = None,
    ) -> None: ...

class HyperlinkList(Serialisable):
    tagname: str
    hyperlink: Incomplete
    def __init__(self, hyperlink=()) -> None: ...
    def __bool__(self) -> bool: ...
    def __len__(self) -> int: ...
    def append(self, value) -> None: ...
