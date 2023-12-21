from _typeshed import Incomplete
from collections.abc import Iterable
from dataclasses import dataclass
from io import BytesIO
from typing_extensions import Literal

from PIL import Image

from .drawing import DeviceGray, DeviceRGB
from .enums import Align, TableBordersLayout, TableCellFillMode, VAlign, WrapMode
from .fonts import FontFace
from .fpdf import FPDF
from .util import Padding

DEFAULT_HEADINGS_STYLE: FontFace

class Table:
    rows: list[Row]

    def __init__(
        self,
        fpdf: FPDF,
        rows: Iterable[str] = (),
        *,
        align: str | Align = "CENTER",
        v_align: str | VAlign = "MIDDLE",
        borders_layout: str | TableBordersLayout = ...,
        cell_fill_color: int | tuple[Incomplete, ...] | DeviceGray | DeviceRGB | None = None,
        cell_fill_mode: str | TableCellFillMode = ...,
        col_widths: int | tuple[int, ...] | None = None,
        first_row_as_headings: bool = True,
        gutter_height: float = 0,
        gutter_width: float = 0,
        headings_style: FontFace = ...,
        line_height: int | None = None,
        markdown: bool = False,
        text_align: str | Align = "JUSTIFY",
        width: int | None = None,
        wrapmode: WrapMode = ...,
        padding: float | Padding | None = None,
        outer_border_width: float | None = None,
        num_heading_rows: int = 1,
    ) -> None: ...
    def row(self, cells: Iterable[str] = (), style: FontFace | None = None) -> Row: ...
    def render(self) -> None: ...
    def get_cell_border(self, i, j) -> str | Literal[0, 1]: ...

class Row:
    cells: list[Cell]
    style: FontFace
    def __init__(self, table: Table, style: FontFace | None = None) -> None: ...
    @property
    def cols_count(self) -> int: ...
    @property
    def column_indices(self): ...
    def cell(
        self,
        text: str = "",
        align: str | Align | None = None,
        v_align: str | VAlign | None = None,
        style: FontFace | None = None,
        img: str | Image.Image | BytesIO | None = None,
        img_fill_width: bool = False,
        colspan: int = 1,
        padding: tuple[float, ...] | None = None,
        link: str | int | None = None,
    ) -> Cell: ...

@dataclass
class Cell:
    text: str
    align: str | Align | None
    v_align: str | VAlign | None
    style: FontFace | None
    img: str | None
    img_fill_width: bool
    colspan: int
    padding: int | tuple[float, ...] | None
    link: str | int | None

    def write(self, text, align: Incomplete | None = None): ...

@dataclass(frozen=True)
class RowLayoutInfo:
    height: int
    triggers_page_jump: bool
    rendered_height: dict[Incomplete, Incomplete]

def draw_box_borders(pdf: FPDF, x1, y1, x2, y2, border: str | Literal[0, 1], fill_color: Incomplete | None = None) -> None: ...
