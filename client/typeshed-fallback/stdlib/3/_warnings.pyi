from typing import Any, List, Optional, Type

_defaultaction: str
_onceregistry: dict
filters: List[tuple]

def warn(message: Warning, category: Optional[Type[Warning]] = ..., stacklevel: int = ...) -> None: ...
def warn_explicit(message: Warning, category: Optional[Type[Warning]],
                  filename: str, lineno: int,
                  module: Any = ..., registry: dict = ...,
                  module_globals: dict = ...) -> None: ...
