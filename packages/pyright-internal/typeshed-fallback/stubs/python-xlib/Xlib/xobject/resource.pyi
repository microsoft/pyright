from typing import type_check_only

from Xlib._typing import ErrorHandler
from Xlib.protocol import display

# Workaround for pytype crash. Should be Xlib.display._BaseDisplay
@type_check_only
class _BaseDisplay(display.Display):
    def __init__(self, display: str | None = ...) -> None: ...
    def get_atom(self, atomname: str, only_if_exists: bool = ...) -> int: ...

class Resource:
    display: _BaseDisplay
    id: int
    owner: int
    def __init__(self, display: _BaseDisplay, rid: int, owner: int = ...) -> None: ...
    def __resource__(self) -> int: ...
    def kill_client(self, onerror: ErrorHandler[object] | None = ...) -> None: ...
