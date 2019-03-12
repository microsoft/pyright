import _curses
from _curses import *  # noqa: F403
from typing import TypeVar, Callable, Any, Sequence, Mapping

_T = TypeVar('_T')

LINES: int
COLS: int

def initscr() -> _curses._CursesWindow: ...
def start_color() -> None: ...
def wrapper(func: Callable[..., _T], *arg: Any, **kwds: Any) -> _T: ...
