# Stubs for warnings

import sys
from typing import Any, Dict, List, NamedTuple, Optional, overload, TextIO, Tuple, Type, Union, ContextManager
from types import ModuleType

if sys.version_info >= (3, 8):
    from typing import Literal
else:
    from typing_extensions import Literal

@overload
def warn(message: str, category: Optional[Type[Warning]] = ..., stacklevel: int = ...) -> None: ...
@overload
def warn(message: Warning, category: Any = ..., stacklevel: int = ...) -> None: ...
@overload
def warn_explicit(message: str, category: Type[Warning],
                  filename: str, lineno: int, module: Optional[str] = ...,
                  registry: Optional[Dict[Union[str, Tuple[str, Type[Warning], int]], int]] = ...,
                  module_globals: Optional[Dict[str, Any]] = ...) -> None: ...
@overload
def warn_explicit(message: Warning, category: Any,
                  filename: str, lineno: int, module: Optional[str] = ...,
                  registry: Optional[Dict[Union[str, Tuple[str, Type[Warning], int]], int]] = ...,
                  module_globals: Optional[Dict[str, Any]] = ...) -> None: ...
def showwarning(message: str, category: Type[Warning], filename: str,
                lineno: int, file: Optional[TextIO] = ...,
                line: Optional[str] = ...) -> None: ...
def formatwarning(message: str, category: Type[Warning], filename: str,
                  lineno: int, line: Optional[str] = ...) -> str: ...
def filterwarnings(action: str, message: str = ...,
                   category: Type[Warning] = ..., module: str = ...,
                   lineno: int = ..., append: bool = ...) -> None: ...
def simplefilter(action: str, category: Type[Warning] = ..., lineno: int = ...,
                 append: bool = ...) -> None: ...
def resetwarnings() -> None: ...

class _Record(NamedTuple):
    message: str
    category: Type[Warning]
    filename: str
    lineno: int
    file: Optional[TextIO]
    line: Optional[str]


@overload
def catch_warnings(*, record: Literal[False] = ..., module: Optional[ModuleType] = ...) -> ContextManager[None]: ...

@overload
def catch_warnings(*, record: Literal[True], module: Optional[ModuleType] = ...) -> ContextManager[List[_Record]]: ...

@overload
def catch_warnings(*, record: bool, module: Optional[ModuleType] = ...) -> ContextManager[Optional[List[_Record]]]: ...
