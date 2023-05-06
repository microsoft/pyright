from typing import Any, ClassVar
from typing_extensions import Literal

from ._imaging import _PixelAccessor
from .ImageFile import ImageFile

class Jpeg2KImageFile(ImageFile):
    format: ClassVar[Literal["JPEG2000"]]
    format_description: ClassVar[str]
    reduce: Any
    tile: Any
    def load(self) -> _PixelAccessor: ...
