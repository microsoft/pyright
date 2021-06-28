from collections.abc import Container
from typing import Any, Tuple, Union, overload
from typing_extensions import Literal

from .Image import Image
from .ImageFont import _Font

_Ink = Union[str, Tuple[int, int, int]]

class ImageDraw:
    def __init__(self, im: Image, mode: str | None = ...) -> None: ...
    def getfont(self): ...
    def arc(self, xy, start, end, fill: _Ink | None = ..., width: float = ...) -> None: ...
    def bitmap(self, xy, bitmap, fill: _Ink | None = ...) -> None: ...
    def chord(self, xy, start, end, fill: _Ink | None = ..., outline: _Ink | None = ..., width: float = ...) -> None: ...
    def ellipse(self, xy, fill: _Ink | None = ..., outline: _Ink | None = ..., width: float = ...) -> None: ...
    def line(self, xy, fill: _Ink | None = ..., width: float = ..., joint=...) -> None: ...
    def shape(self, shape, fill: _Ink | None = ..., outline: _Ink | None = ...) -> None: ...
    def pieslice(
        self,
        xy: tuple[tuple[float, float], tuple[float, float]],
        start: float,
        end: float,
        fill: _Ink | None = ...,
        outline: _Ink | None = ...,
        width: float = ...,
    ) -> None: ...
    def point(self, xy, fill: _Ink | None = ...) -> None: ...
    def polygon(self, xy, fill: _Ink | None = ..., outline: _Ink | None = ...) -> None: ...
    def regular_polygon(
        self, bounding_circle, n_sides: int, rotation: float = ..., fill: _Ink | None = ..., outline: _Ink | None = ...
    ): ...
    def rectangle(
        self,
        xy: tuple[float, float, float, float] | tuple[tuple[float, float], tuple[float, float]],
        fill: _Ink | None = ...,
        outline: _Ink | None = ...,
        width: float = ...,
    ) -> None: ...
    def rounded_rectangle(
        self,
        xy: tuple[float, float, float, float] | tuple[tuple[float, float], tuple[float, float]],
        radius: float = ...,
        fill: _Ink | None = ...,
        outline: _Ink | None = ...,
        width: float = ...,
    ) -> None: ...
    def text(
        self,
        xy: tuple[float, float],
        text: str | bytes,
        fill: _Ink | None = ...,
        font: _Font | None = ...,
        anchor=...,
        spacing: float = ...,
        align: Literal["left", "center", "right"] = ...,
        direction: Literal["rtl", "ltr", "ttb"] | None = ...,
        features=...,
        language: str | None = ...,
        stroke_width: float = ...,
        stroke_fill: _Ink | None = ...,
        embedded_color: bool = ...,
        *args,
        **kwargs,
    ) -> None: ...
    def multiline_text(
        self,
        xy: tuple[float, float],
        text: str | bytes,
        fill: _Ink | None = ...,
        font: _Font | None = ...,
        anchor: Any | None = ...,
        spacing: float = ...,
        align: Literal["left", "center", "right"] = ...,
        direction: Literal["rtl", "ltr", "ttb"] | None = ...,
        features: Any | None = ...,
        language: str | None = ...,
        stroke_width: float = ...,
        stroke_fill: _Ink | None = ...,
        embedded_color: bool = ...,
    ) -> None: ...
    def textsize(
        self,
        text: str | bytes,
        font: _Font | None = ...,
        spacing: float = ...,
        direction: Literal["rtl", "ltr", "ttb"] | None = ...,
        features=...,
        language: str | None = ...,
        stroke_width: float = ...,
    ) -> tuple[int, int]: ...
    def multiline_textsize(
        self,
        text: str | bytes,
        font: _Font | None = ...,
        spacing: float = ...,
        direction: Literal["rtl", "ltr", "ttb"] | None = ...,
        features=...,
        language: str | None = ...,
        stroke_width: float = ...,
    ) -> tuple[int, int]: ...
    def textlength(
        self,
        text: str | bytes,
        font: _Font | None = ...,
        direction: Literal["rtl", "ltr", "ttb"] | None = ...,
        features=...,
        language: str | None = ...,
        embedded_color: bool = ...,
    ) -> int: ...
    def textbbox(
        self,
        xy: tuple[float, float],
        text: str | bytes,
        font: _Font | None = ...,
        anchor: Any | None = ...,
        spacing: float = ...,
        align: Literal["left", "center", "right"] = ...,
        direction: Literal["rtl", "ltr", "ttb"] | None = ...,
        features: Any | None = ...,
        language: str | None = ...,
        stroke_width: float = ...,
        embedded_color: bool = ...,
    ) -> tuple[int, int, int, int]: ...
    def multiline_textbbox(
        self,
        xy: tuple[float, float],
        text: str | bytes,
        font: _Font | None = ...,
        anchor: Any | None = ...,
        spacing: float = ...,
        align: Literal["left", "center", "right"] = ...,
        direction: Literal["rtl", "ltr", "ttb"] | None = ...,
        features: Any | None = ...,
        language: str | None = ...,
        stroke_width: float = ...,
        embedded_color: bool = ...,
    ) -> tuple[int, int, int, int]: ...

def Draw(im: Image, mode: str | None = ...) -> ImageDraw: ...

Outline: Any

@overload
def getdraw(im: None = ..., hints: Container[Literal["nicest"]] | None = ...) -> tuple[None, Any]: ...
@overload
def getdraw(im: Image, hints: Container[Literal["nicest"]] | None = ...) -> tuple[Image, Any]: ...
def floodfill(image: Image, xy: tuple[float, float], value, border=..., thresh: float = ...) -> None: ...
