from _typeshed import Incomplete

from openpyxl.styles.styleable import StyleableObject

__docformat__: str
TIME_TYPES: Incomplete
TIME_FORMATS: Incomplete
STRING_TYPES: Incomplete
KNOWN_TYPES: Incomplete
ILLEGAL_CHARACTERS_RE: Incomplete
ERROR_CODES: Incomplete
TYPE_STRING: str
TYPE_FORMULA: str
TYPE_NUMERIC: str
TYPE_BOOL: str
TYPE_NULL: str
TYPE_INLINE: str
TYPE_ERROR: str
TYPE_FORMULA_CACHE_STRING: str
VALID_TYPES: Incomplete

def get_type(t, value): ...
def get_time_format(t): ...

class Cell(StyleableObject):
    row: Incomplete
    column: Incomplete
    data_type: str
    def __init__(
        self,
        worksheet,
        row: Incomplete | None = ...,
        column: Incomplete | None = ...,
        value: Incomplete | None = ...,
        style_array: Incomplete | None = ...,
    ) -> None: ...
    @property
    def coordinate(self): ...
    @property
    def col_idx(self): ...
    @property
    def column_letter(self): ...
    @property
    def encoding(self): ...
    @property
    def base_date(self): ...
    def check_string(self, value): ...
    def check_error(self, value): ...
    @property
    def value(self): ...
    @value.setter
    def value(self, value) -> None: ...
    @property
    def internal_value(self): ...
    @property
    def hyperlink(self): ...
    @hyperlink.setter
    def hyperlink(self, val) -> None: ...
    @property
    def is_date(self): ...
    def offset(self, row: int = ..., column: int = ...): ...
    @property
    def comment(self): ...
    @comment.setter
    def comment(self, value) -> None: ...

class MergedCell(StyleableObject):
    data_type: str
    comment: Incomplete
    hyperlink: Incomplete
    row: Incomplete
    column: Incomplete
    def __init__(self, worksheet, row: Incomplete | None = ..., column: Incomplete | None = ...) -> None: ...
    @property
    def coordinate(self): ...
    value: Incomplete

def WriteOnlyCell(ws: Incomplete | None = ..., value: Incomplete | None = ...): ...
