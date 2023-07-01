from _typeshed import Incomplete
from enum import IntEnum
from typing import Any, ClassVar
from typing_extensions import Literal

from .ImageFile import ImageFile

class LoadingStrategy(IntEnum):
    RGB_AFTER_FIRST = 0
    RGB_AFTER_DIFFERENT_PALETTE_ONLY = 1
    RGB_ALWAYS = 2

LOADING_STRATEGY: LoadingStrategy

class GifImageFile(ImageFile):
    format: ClassVar[Literal["GIF"]]
    format_description: ClassVar[str]
    global_palette: Any
    def data(self): ...
    @property
    def n_frames(self): ...
    @property
    def is_animated(self): ...
    im: Any
    def seek(self, frame) -> None: ...
    def tell(self): ...

RAWMODE: Any

def get_interlace(im): ...
def getheader(im, palette: Incomplete | None = None, info: Incomplete | None = None): ...
def getdata(im, offset=(0, 0), **params): ...
