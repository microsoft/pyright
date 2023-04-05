from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class Record(Serialisable):
    tagname: str
    m: Incomplete
    n: Incomplete
    b: Incomplete
    e: Incomplete
    s: Incomplete
    d: Incomplete
    x: Incomplete
    def __init__(
        self,
        _fields=(),
        m: Incomplete | None = None,
        n: Incomplete | None = None,
        b: Incomplete | None = None,
        e: Incomplete | None = None,
        s: Incomplete | None = None,
        d: Incomplete | None = None,
        x: Incomplete | None = None,
    ) -> None: ...

class RecordList(Serialisable):
    mime_type: str
    rel_type: str
    tagname: str
    r: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    __attrs__: Incomplete
    def __init__(self, count: Incomplete | None = None, r=(), extLst: Incomplete | None = None) -> None: ...
    @property
    def count(self): ...
    def to_tree(self): ...
    @property
    def path(self): ...
