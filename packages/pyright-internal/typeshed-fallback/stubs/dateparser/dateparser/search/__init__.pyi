import sys
from datetime import datetime
from typing import Any, List, Mapping, Set, Tuple, overload

if sys.version_info >= (3, 8):
    from typing import Literal
else:
    from typing_extensions import Literal

@overload
def search_dates(
    text: str,
    languages: List[str] | Tuple[str] | Set[str] | None,
    settings: Mapping[Any, Any] | None,
    add_detected_language: Literal[True],
) -> List[Tuple[str, datetime, str]]: ...
@overload
def search_dates(
    text: str,
    languages: List[str] | Tuple[str] | Set[str] | None = ...,
    settings: Mapping[Any, Any] | None = ...,
    add_detected_language: Literal[False] = ...,
) -> List[Tuple[str, datetime]]: ...
