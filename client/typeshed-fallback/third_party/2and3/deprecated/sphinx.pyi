from typing import Any, Callable, Optional, Type, TypeVar
from typing_extensions import Literal

from .classic import ClassicAdapter

_T = TypeVar("_T", bound=Callable[..., Any])

class SphinxAdapter(ClassicAdapter):
    directive: Literal["versionadded", "versionchanged", "deprecated"]
    reason: str
    version: str
    action: Optional[str]
    category: Type[DeprecationWarning]
    def __init__(
        self,
        directive: Literal["versionadded", "versionchanged", "deprecated"],
        reason: str = ...,
        version: str = ...,
        action: Optional[str] = ...,
        category: Type[DeprecationWarning] = ...,
    ) -> None: ...
    def __call__(self, wrapped: _T) -> Callable[[_T], _T]: ...

def versionadded(reason: str = ..., version: str = ...) -> Callable[[_T], _T]: ...
def versionchanged(reason: str = ..., version: str = ...) -> Callable[[_T], _T]: ...
def deprecated(
    *, reason: str = ..., version: str = ..., action: Optional[str] = ..., category: Optional[Type[DeprecationWarning]] = ...,
) -> Callable[[_T], _T]: ...
