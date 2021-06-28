from _typeshed import SupportsRead
from typing import Any, Protocol
from typing_extensions import Literal

LAYOUT_BASIC: Literal[0]
LAYOUT_RAQM: Literal[1]

class _Font(Protocol):
    def getmask(self, text: str, mode: str = ..., direction=..., features=...): ...

class ImageFont:
    def getsize(self, text: str, *args, **kwargs) -> tuple[int, int]: ...
    def getmask(self, text: str, mode: str = ..., direction=..., features=...): ...

class FreeTypeFont:
    path: str | bytes | SupportsRead[bytes] | None
    size: int
    index: int
    encoding: str
    layout_engine: Any
    def __init__(
        self,
        font: str | bytes | SupportsRead[bytes] | None = ...,
        size: int = ...,
        index: int = ...,
        encoding: str = ...,
        layout_engine: int | None = ...,
    ) -> None: ...
    def getname(self) -> tuple[str, str]: ...
    def getmetrics(self): ...
    def getlength(
        self,
        text,
        mode=...,
        direction: Literal["ltr", "rtl", "ttb"] | None = ...,
        features: Any | None = ...,
        language: str | None = ...,
    ) -> int: ...
    def getbbox(
        self, text, mode: str = ..., direction=..., features=..., language: str | None = ..., stroke_width: int = ..., anchor=...
    ): ...
    def getsize(
        self,
        text,
        direction: Literal["ltr", "rtl", "ttb"] | None = ...,
        features: Any | None = ...,
        language: str | None = ...,
        stroke_width: int = ...,
    ) -> tuple[int, int]: ...
    def getsize_multiline(
        self,
        text,
        direction: Literal["ltr", "rtl", "ttb"] | None = ...,
        spacing: float = ...,
        features: Any | None = ...,
        language: str | None = ...,
        stroke_width: float = ...,
    ): ...
    def getoffset(self, text) -> tuple[int, int]: ...
    def getmask(
        self,
        text: str,
        mode: str = ...,
        direction: Literal["ltr", "rtl", "ttb"] | None = ...,
        features: Any | None = ...,
        language: str | None = ...,
        stroke_width: float = ...,
        anchor=...,
        ink=...,
    ): ...
    def getmask2(
        self,
        text,
        mode: str = ...,
        fill=...,
        direction: Literal["ltr", "rtl", "ttb"] | None = ...,
        features: Any | None = ...,
        language: str | None = ...,
        stroke_width: float = ...,
        anchor=...,
        ink=...,
        *args,
        **kwargs,
    ): ...
    def font_variant(self, font=..., size=..., index=..., encoding=..., layout_engine=...): ...
    def get_variation_names(self): ...
    def set_variation_by_name(self, name): ...
    def get_variation_axes(self): ...
    def set_variation_by_axes(self, axes): ...

class TransposedFont:
    def __init__(self, font, orientation=...): ...
    def getsize(self, text, *args, **kwargs): ...
    def getmask(self, text, mode: str = ..., *args, **kwargs): ...

def load(filename) -> ImageFont: ...
def truetype(
    font: str | bytes | SupportsRead[bytes] | None = ...,
    size: int = ...,
    index: int = ...,
    encoding: str = ...,
    layout_engine: int | None = ...,
) -> FreeTypeFont: ...
def load_path(filename: str | bytes) -> ImageFont: ...
def load_default() -> ImageFont: ...
