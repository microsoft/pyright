from _typeshed import Incomplete
from collections.abc import Callable
from typing import IO, Any, AnyStr

__version__: str

def encode(
    obj: Any,
    ensure_ascii: bool = ...,
    double_precision: int = ...,
    encode_html_chars: bool = ...,
    escape_forward_slashes: bool = ...,
    sort_keys: bool = ...,
    indent: int = ...,
    allow_nan: bool = ...,
    reject_bytes: bool = ...,
    default: Callable[[Incomplete], Incomplete] | None = None,
    separators: tuple[str, str] | None = None,
) -> str: ...
def dumps(
    obj: Any,
    ensure_ascii: bool = ...,
    double_precision: int = ...,
    encode_html_chars: bool = ...,
    escape_forward_slashes: bool = ...,
    sort_keys: bool = ...,
    indent: int = ...,
    allow_nan: bool = ...,
    reject_bytes: bool = ...,
    default: Callable[[Incomplete], Incomplete] | None = None,
    separators: tuple[str, str] | None = None,
) -> str: ...
def dump(
    obj: Any,
    fp: IO[str],
    *,
    ensure_ascii: bool = ...,
    double_precision: int = ...,
    encode_html_chars: bool = ...,
    escape_forward_slashes: bool = ...,
    sort_keys: bool = ...,
    indent: int = ...,
    allow_nan: bool = ...,
    reject_bytes: bool = ...,
    default: Callable[[Incomplete], Incomplete] | None = None,
    separators: tuple[str, str] | None = None,
) -> None: ...
def decode(s: AnyStr, precise_float: bool = ...) -> Any: ...
def loads(s: AnyStr, precise_float: bool = ...) -> Any: ...
def load(fp: IO[AnyStr], precise_float: bool = ...) -> Any: ...

class JSONDecodeError(ValueError): ...
