from typing import Any, ClassVar
from typing_extensions import Final, Literal

from .ImageFile import ImageFile, PyDecoder

BIT2MODE: Any

class BmpImageFile(ImageFile):
    RAW: Final = 0
    RLE8: Final = 1
    RLE4: Final = 2
    BITFIELDS: Final = 3
    JPEG: Final = 4
    PNG: Final = 5
    format_description: ClassVar[str]
    format: ClassVar[Literal["BMP", "DIB", "CUR"]]
    COMPRESSIONS: Any

class BmpRleDecoder(PyDecoder):
    def decode(self, buffer): ...

class DibImageFile(BmpImageFile):
    format: ClassVar[Literal["DIB"]]

SAVE: Any
