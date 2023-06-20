from _typeshed import Incomplete
from typing import ClassVar

from openpyxl.descriptors.serialisable import Serialisable

class Protection(Serialisable):
    tagname: ClassVar[str]
    locked: Incomplete
    hidden: Incomplete
    def __init__(self, locked: bool = True, hidden: bool = False) -> None: ...
