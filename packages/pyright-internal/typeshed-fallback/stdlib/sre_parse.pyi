import sys
from collections.abc import Iterable
from re import Match, Pattern as _Pattern
from sre_constants import *
from sre_constants import _NamedIntConstant as _NIC, error as _Error
from typing import Any, overload
from typing_extensions import TypeAlias

SPECIAL_CHARS: str
REPEAT_CHARS: str
DIGITS: frozenset[str]
OCTDIGITS: frozenset[str]
HEXDIGITS: frozenset[str]
ASCIILETTERS: frozenset[str]
WHITESPACE: frozenset[str]
ESCAPES: dict[str, tuple[_NIC, int]]
CATEGORIES: dict[str, tuple[_NIC, _NIC] | tuple[_NIC, list[tuple[_NIC, _NIC]]]]
FLAGS: dict[str, int]
TYPE_FLAGS: int
GLOBAL_FLAGS: int

if sys.version_info >= (3, 11):
    MAXWIDTH: int

if sys.version_info < (3, 11):
    class Verbose(Exception): ...

class _State:
    flags: int
    groupdict: dict[str, int]
    groupwidths: list[int | None]
    lookbehindgroups: int | None
    @property
    def groups(self) -> int: ...
    def opengroup(self, name: str | None = ...) -> int: ...
    def closegroup(self, gid: int, p: SubPattern) -> None: ...
    def checkgroup(self, gid: int) -> bool: ...
    def checklookbehindgroup(self, gid: int, source: Tokenizer) -> None: ...

if sys.version_info >= (3, 8):
    State: TypeAlias = _State
else:
    Pattern: TypeAlias = _State

_OpSubpatternType: TypeAlias = tuple[int | None, int, int, SubPattern]
_OpGroupRefExistsType: TypeAlias = tuple[int, SubPattern, SubPattern]
_OpInType: TypeAlias = list[tuple[_NIC, int]]
_OpBranchType: TypeAlias = tuple[None, list[SubPattern]]
_AvType: TypeAlias = _OpInType | _OpBranchType | Iterable[SubPattern] | _OpGroupRefExistsType | _OpSubpatternType
_CodeType: TypeAlias = tuple[_NIC, _AvType]

class SubPattern:
    data: list[_CodeType]
    width: int | None

    if sys.version_info >= (3, 8):
        state: State
        def __init__(self, state: State, data: list[_CodeType] | None = None) -> None: ...
    else:
        pattern: Pattern
        def __init__(self, pattern: Pattern, data: list[_CodeType] | None = None) -> None: ...

    def dump(self, level: int = 0) -> None: ...
    def __len__(self) -> int: ...
    def __delitem__(self, index: int | slice) -> None: ...
    def __getitem__(self, index: int | slice) -> SubPattern | _CodeType: ...
    def __setitem__(self, index: int | slice, code: _CodeType) -> None: ...
    def insert(self, index: int, code: _CodeType) -> None: ...
    def append(self, code: _CodeType) -> None: ...
    def getwidth(self) -> tuple[int, int]: ...

class Tokenizer:
    istext: bool
    string: Any
    decoded_string: str
    index: int
    next: str | None
    def __init__(self, string: Any) -> None: ...
    def match(self, char: str) -> bool: ...
    def get(self) -> str | None: ...
    def getwhile(self, n: int, charset: Iterable[str]) -> str: ...
    if sys.version_info >= (3, 8):
        def getuntil(self, terminator: str, name: str) -> str: ...
    else:
        def getuntil(self, terminator: str) -> str: ...

    @property
    def pos(self) -> int: ...
    def tell(self) -> int: ...
    def seek(self, index: int) -> None: ...
    def error(self, msg: str, offset: int = 0) -> _Error: ...

    if sys.version_info >= (3, 12):
        def checkgroupname(self, name: str, offset: int) -> None: ...
    elif sys.version_info >= (3, 11):
        def checkgroupname(self, name: str, offset: int, nested: int) -> None: ...

def fix_flags(src: str | bytes, flags: int) -> int: ...

_TemplateType: TypeAlias = tuple[list[tuple[int, int]], list[str | None]]
_TemplateByteType: TypeAlias = tuple[list[tuple[int, int]], list[bytes | None]]

if sys.version_info >= (3, 12):
    @overload
    def parse_template(source: str, pattern: _Pattern[Any]) -> _TemplateType: ...
    @overload
    def parse_template(source: bytes, pattern: _Pattern[Any]) -> _TemplateByteType: ...

elif sys.version_info >= (3, 8):
    @overload
    def parse_template(source: str, state: _Pattern[Any]) -> _TemplateType: ...
    @overload
    def parse_template(source: bytes, state: _Pattern[Any]) -> _TemplateByteType: ...

else:
    @overload
    def parse_template(source: str, pattern: _Pattern[Any]) -> _TemplateType: ...
    @overload
    def parse_template(source: bytes, pattern: _Pattern[Any]) -> _TemplateByteType: ...

if sys.version_info >= (3, 8):
    def parse(str: str, flags: int = 0, state: State | None = None) -> SubPattern: ...

else:
    def parse(str: str, flags: int = 0, pattern: Pattern | None = None) -> SubPattern: ...

if sys.version_info < (3, 12):
    def expand_template(template: _TemplateType, match: Match[Any]) -> str: ...
