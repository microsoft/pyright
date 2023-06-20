from datetime import date, datetime, time, timedelta
from decimal import Decimal
from re import Pattern
from typing import overload
from typing_extensions import Final, TypeAlias

from openpyxl.cell.rich_text import CellRichText
from openpyxl.comments.comments import Comment
from openpyxl.styles.cell_style import StyleArray
from openpyxl.styles.styleable import StyleableObject
from openpyxl.worksheet.formula import ArrayFormula, DataTableFormula
from openpyxl.worksheet.hyperlink import Hyperlink
from openpyxl.worksheet.worksheet import Worksheet

_TimeTypes: TypeAlias = datetime | date | time | timedelta
_CellValue: TypeAlias = (  # if numpy is installed also numpy bool and number types
    bool | float | Decimal | str | CellRichText | _TimeTypes | DataTableFormula | ArrayFormula
)

__docformat__: Final = "restructuredtext en"
TIME_TYPES: Final[tuple[type, ...]]
TIME_FORMATS: Final[dict[type[_TimeTypes], str]]
STRING_TYPES: Final[tuple[type, ...]]
KNOWN_TYPES: Final[tuple[type, ...]]

ILLEGAL_CHARACTERS_RE: Final[Pattern[str]]
ERROR_CODES: Final[tuple[str, ...]]

TYPE_STRING: Final = "s"
TYPE_FORMULA: Final = "f"
TYPE_NUMERIC: Final = "n"
TYPE_BOOL: Final = "b"
TYPE_NULL: Final = "n"
TYPE_INLINE: Final = "inlineStr"
TYPE_ERROR: Final = "e"
TYPE_FORMULA_CACHE_STRING: Final = "str"

VALID_TYPES: Final[tuple[str, ...]]

def get_type(t: type, value: object) -> str | None: ...
def get_time_format(t: datetime) -> str: ...

class Cell(StyleableObject):
    row: int
    column: int
    data_type: str
    def __init__(
        self,
        worksheet: Worksheet,
        row: int | None = None,
        column: int | None = None,
        value: str | float | datetime | None = None,
        style_array: StyleArray | None = None,
    ) -> None: ...
    @property
    def coordinate(self) -> str: ...
    @property
    def col_idx(self) -> int: ...
    @property
    def column_letter(self) -> str: ...
    @property
    def encoding(self) -> str: ...
    @property
    def base_date(self) -> datetime: ...
    @overload
    def check_string(self, value: None) -> None: ...
    @overload
    def check_string(self, value: str | bytes) -> str: ...
    def check_error(self, value: object) -> str: ...
    @property
    def value(self) -> _CellValue: ...
    @value.setter
    def value(self, value: _CellValue | bytes | None) -> None: ...
    @property
    def internal_value(self) -> _CellValue: ...
    @property
    def hyperlink(self) -> Hyperlink | None: ...
    @hyperlink.setter
    def hyperlink(self, val: Hyperlink | str | None) -> None: ...
    @property
    def is_date(self) -> bool: ...
    def offset(self, row: int = 0, column: int = 0) -> Cell: ...
    @property
    def comment(self) -> Comment | None: ...
    @comment.setter
    def comment(self, value: Comment | None) -> None: ...

class MergedCell(StyleableObject):
    data_type: str
    comment: Comment | None
    hyperlink: Hyperlink | None
    row: int
    column: int
    def __init__(self, worksheet: Worksheet, row: int | None = None, column: int | None = None) -> None: ...
    @property
    def coordinate(self) -> str: ...
    value: str | float | int | datetime | None

def WriteOnlyCell(ws: Worksheet | None = None, value: str | float | datetime | None = None) -> Cell: ...
