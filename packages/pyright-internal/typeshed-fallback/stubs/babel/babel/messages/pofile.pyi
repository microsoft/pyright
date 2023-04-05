from _typeshed import SupportsWrite
from collections.abc import Iterable
from re import Pattern

from babel.core import Locale
from babel.messages.catalog import Catalog

def unescape(string: str) -> str: ...
def denormalize(string: str) -> str: ...

class PoFileError(Exception):
    catalog: Catalog
    line: str
    lineno: int
    def __init__(self, message: str, catalog: Catalog, line: str, lineno: int) -> None: ...

class _NormalizedString:
    def __init__(self, *args: str) -> None: ...
    def append(self, s: str) -> None: ...
    def denormalize(self) -> str: ...
    def __bool__(self) -> bool: ...
    def __cmp__(self, other: object) -> int: ...
    def __gt__(self, other: object) -> bool: ...
    def __lt__(self, other: object) -> bool: ...
    def __ge__(self, other: object) -> bool: ...
    def __le__(self, other: object) -> bool: ...
    def __eq__(self, other: object) -> bool: ...
    def __ne__(self, other: object) -> bool: ...

class PoFileParser:
    catalog: Catalog
    ignore_obsolete: bool
    counter: int
    offset: int
    abort_invalid: bool
    # Internal variables:
    messages: list[_NormalizedString]
    # [index, string] lists
    translations: list[list[int | _NormalizedString]]
    locations: list[tuple[str, int | None]]
    flags: list[str]
    user_comments: list[str]
    auto_comments: list[str]
    context: str | None
    obsolete: bool
    in_msgid: bool
    in_msgstr: bool
    in_msgctxt: bool
    def __init__(self, catalog, ignore_obsolete: bool = False, abort_invalid: bool = False) -> None: ...
    def parse(self, fileobj: Iterable[str | bytes]) -> None: ...

def read_po(
    fileobj: Iterable[str | bytes],
    locale: str | Locale | None = None,
    domain: str | None = None,
    ignore_obsolete: bool = False,
    charset: str | None = None,
    abort_invalid: bool = False,
) -> Catalog: ...

WORD_SEP: Pattern[str]

def escape(string: str) -> str: ...
def normalize(string: str, prefix: str = "", width: int = 76) -> str: ...
def write_po(
    fileobj: SupportsWrite[bytes],
    catalog: Catalog,
    width: int | None = 76,
    no_location: bool = False,
    omit_header: bool = False,
    sort_output: bool = False,
    sort_by_file: bool = False,
    ignore_obsolete: bool = False,
    include_previous: bool = False,
    include_lineno: bool = True,
) -> None: ...
