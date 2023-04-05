from _typeshed import Incomplete
from re import Pattern
from typing_extensions import Self

from openpyxl.descriptors import Integer, Strict, String
from openpyxl.utils.cell import SHEETRANGE_RE as SHEETRANGE_RE

from .cell_range import MultiCellRange

COL_RANGE: str
COL_RANGE_RE: Pattern[str]
ROW_RANGE: str
ROW_RANGE_RE: Pattern[str]
TITLES_REGEX: Pattern[str]
PRINT_AREA_RE: Pattern[str]

class ColRange(Strict):
    min_col: String
    max_col: String
    def __init__(
        self, range_string: Incomplete | None = None, min_col: Incomplete | None = None, max_col: Incomplete | None = None
    ) -> None: ...
    def __eq__(self, other: object) -> bool: ...

class RowRange(Strict):
    min_row: Integer
    max_row: Integer
    def __init__(
        self, range_string: Incomplete | None = None, min_row: Incomplete | None = None, max_row: Incomplete | None = None
    ) -> None: ...
    def __eq__(self, other: object) -> bool: ...

class PrintTitles(Strict):
    cols: Incomplete
    rows: Incomplete
    title: String
    def __init__(self, cols: Incomplete | None = None, rows: Incomplete | None = None, title: str = "") -> None: ...
    @classmethod
    def from_string(cls, value) -> Self: ...
    def __eq__(self, other: object) -> bool: ...

class PrintArea(MultiCellRange):
    title: str
    @classmethod
    def from_string(cls, value) -> Self: ...
    def __init__(self, ranges=(), title: str = "") -> None: ...
    def __eq__(self, other): ...
