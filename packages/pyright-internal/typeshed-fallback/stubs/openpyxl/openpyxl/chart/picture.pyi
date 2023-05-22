from _typeshed import Incomplete
from typing import ClassVar

from openpyxl.descriptors.serialisable import Serialisable

class PictureOptions(Serialisable):
    tagname: str
    applyToFront: Incomplete
    applyToSides: Incomplete
    applyToEnd: Incomplete
    pictureFormat: Incomplete
    pictureStackUnit: Incomplete
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        applyToFront: Incomplete | None = None,
        applyToSides: Incomplete | None = None,
        applyToEnd: Incomplete | None = None,
        pictureFormat: Incomplete | None = None,
        pictureStackUnit: Incomplete | None = None,
    ) -> None: ...
