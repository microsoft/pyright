from _typeshed import Incomplete
from collections.abc import Sequence
from typing import NamedTuple

from .enums import Align, WrapMode

class Extents(NamedTuple):
    left: float
    right: float

class TextRegionMixin:
    def __init__(self, *args, **kwargs) -> None: ...
    def register_text_region(self, region) -> None: ...
    def is_current_text_region(self, region): ...
    def clear_text_region(self) -> None: ...

class LineWrapper(NamedTuple):
    line: Sequence[Incomplete]
    paragraph: Paragraph
    first_line: bool = False
    last_line: bool = False

class Paragraph:
    pdf: Incomplete
    text_align: Incomplete
    line_height: Incomplete
    top_margin: Incomplete
    bottom_margin: Incomplete
    skip_leading_spaces: Incomplete
    wrapmode: Incomplete

    def __init__(
        self,
        region,
        text_align: Incomplete | None = None,
        line_height: Incomplete | None = None,
        top_margin: float = 0,
        bottom_margin: float = 0,
        skip_leading_spaces: bool = False,
        wrapmode: WrapMode | None = None,
    ) -> None: ...
    def __enter__(self): ...
    def __exit__(self, exc_type, exc_value, traceback) -> None: ...
    def write(self, text: str, link: Incomplete | None = None): ...
    def ln(self, h: float | None = None) -> None: ...
    def build_lines(self, print_sh: bool) -> list[LineWrapper]: ...

class ParagraphCollectorMixin:
    pdf: Incomplete
    text_align: Align | str = "LEFT"
    line_height: Incomplete
    print_sh: Incomplete
    wrapmode: Incomplete
    skip_leading_spaces: Incomplete
    def __init__(
        self,
        pdf,
        *args,
        text: str | None = None,
        text_align: str = "LEFT",
        line_height: float = 1.0,
        print_sh: bool = False,
        skip_leading_spaces: bool = False,
        wrapmode: WrapMode | None = None,
        **kwargs,
    ) -> None: ...
    def __enter__(self): ...
    def __exit__(self, exc_type, exc_value, traceback) -> None: ...
    def write(self, text: str, link: Incomplete | None = None): ...
    def ln(self, h: float | None = None) -> None: ...
    def paragraph(
        self,
        text_align: Incomplete | None = None,
        line_height: Incomplete | None = None,
        skip_leading_spaces: bool = False,
        top_margin: int = 0,
        bottom_margin: int = 0,
        wrapmode: WrapMode | None = None,
    ): ...
    def end_paragraph(self) -> None: ...

class TextRegion(ParagraphCollectorMixin):
    def current_x_extents(self, y, height) -> None: ...
    def collect_lines(self): ...
    def render(self) -> None: ...
    def get_width(self, height): ...

class TextColumnarMixin:
    l_margin: Incomplete
    r_margin: Incomplete
    def __init__(self, pdf, *args, l_margin: Incomplete | None = None, r_margin: Incomplete | None = None, **kwargs) -> None: ...

class TextColumns(TextRegion, TextColumnarMixin):
    balance: Incomplete
    def __init__(self, pdf, *args, ncols: int = 1, gutter: float = 10, balance: bool = False, **kwargs) -> None: ...
    def __enter__(self): ...
    def render(self) -> None: ...
    def current_x_extents(self, y, height): ...
