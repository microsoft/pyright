from _typeshed import IdentityFunction
from typing import Any, Callable, ContextManager, MutableMapping, Optional, TypeVar

_KT = TypeVar("_KT")

def cached(
    cache: Optional[MutableMapping[_KT, Any]], key: Callable[..., _KT] = ..., lock: Optional[ContextManager[Any]] = ...
) -> IdentityFunction: ...
def cachedmethod(
    cache: Callable[[Any], Optional[MutableMapping[_KT, Any]]],
    key: Callable[..., _KT] = ...,
    lock: Optional[ContextManager[Any]] = ...,
) -> IdentityFunction: ...
