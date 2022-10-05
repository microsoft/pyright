import contextlib
from collections.abc import Callable, Iterable, Sequence
from datetime import datetime
from typing import NamedTuple, SupportsInt, TypeVar
from typing_extensions import ParamSpec, SupportsIndex, TypeAlias

from pyscreeze import (
    locate as locate,
    locateAll as locateAll,
    locateAllOnScreen as locateAllOnScreen,
    locateCenterOnScreen as locateCenterOnScreen,
    locateOnScreen as locateOnScreen,
    locateOnWindow as locateOnWindow,
)

class PyAutoGUIException(Exception): ...
class FailSafeException(PyAutoGUIException): ...
class ImageNotFoundException(PyAutoGUIException): ...

_P = ParamSpec("_P")
_R = TypeVar("_R")
_NormalizeableXArg: TypeAlias = str | SupportsInt | Sequence[SupportsInt]

def raisePyAutoGUIImageNotFoundException(wrappedFunction: Callable[_P, _R]) -> Callable[_P, _R]: ...
def mouseInfo() -> None: ...
def useImageNotFoundException(value: bool | None = ...) -> None: ...

KEY_NAMES: list[str]
KEYBOARD_KEYS: list[str]
LEFT: str
MIDDLE: str
RIGHT: str
PRIMARY: str
SECONDARY: str
QWERTY: str
QWERTZ: str

def isShiftCharacter(character: str) -> bool: ...

MINIMUM_DURATION: float
MINIMUM_SLEEP: float
PAUSE: float
DARWIN_CATCH_UP_TIME: float
FAILSAFE: bool
FAILSAFE_POINTS: list[tuple[int, int]]
LOG_SCREENSHOTS: bool
LOG_SCREENSHOTS_LIMIT: int
G_LOG_SCREENSHOTS_FILENAMES: list[str]

class Point(NamedTuple):
    x: float
    y: float

class Size(NamedTuple):
    width: int
    height: int

def getPointOnLine(x1: float, y1: float, x2: float, y2: float, n: float) -> tuple[float, float]: ...
def linear(n: float) -> float: ...
def position(x: int | None = ..., y: int | None = ...) -> Point: ...
def size() -> Size: ...
def onScreen(x: _NormalizeableXArg | None, y: SupportsInt | None = ...) -> bool: ...
def mouseDown(
    x: _NormalizeableXArg | None = ...,
    y: SupportsInt | None = ...,
    # Docstring says `button` can also be `int`, but `.lower()` is called unconditionally in `_normalizeButton()`
    button: str = ...,
    duration: float = ...,
    tween: Callable[[float], float] = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
) -> None: ...
def mouseUp(
    x: _NormalizeableXArg | None = ...,
    y: SupportsInt | None = ...,
    # Docstring says `button` can also be `int`, but `.lower()` is called unconditionally in `_normalizeButton()`
    button: str = ...,
    duration: float = ...,
    tween: Callable[[float], float] = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
) -> None: ...
def click(
    x: _NormalizeableXArg | None = ...,
    y: SupportsInt | None = ...,
    clicks: SupportsIndex = ...,
    interval: float = ...,
    # Docstring says `button` can also be `int`, but `.lower()` is called unconditionally in `_normalizeButton()`
    button: str = ...,
    duration: float = ...,
    tween: Callable[[float], float] = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
) -> None: ...
def leftClick(
    x: _NormalizeableXArg | None = ...,
    y: SupportsInt | None = ...,
    interval: float = ...,
    duration: float = ...,
    tween: Callable[[float], float] = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
) -> None: ...
def rightClick(
    x: _NormalizeableXArg | None = ...,
    y: SupportsInt | None = ...,
    interval: float = ...,
    duration: float = ...,
    tween: Callable[[float], float] = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
) -> None: ...
def middleClick(
    x: _NormalizeableXArg | None = ...,
    y: SupportsInt | None = ...,
    interval: float = ...,
    duration: float = ...,
    tween: Callable[[float], float] = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
) -> None: ...
def doubleClick(
    x: _NormalizeableXArg | None = ...,
    y: SupportsInt | None = ...,
    interval: float = ...,
    # Docstring says `button` can also be `int`, but `.lower()` is called unconditionally in `_normalizeButton()`
    button: str = ...,
    duration: float = ...,
    tween: Callable[[float], float] = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
) -> None: ...
def tripleClick(
    x: _NormalizeableXArg | None = ...,
    y: SupportsInt | None = ...,
    interval: float = ...,
    # Docstring says `button` can also be `int`, but `.lower()` is called unconditionally in `_normalizeButton()`
    button: str = ...,
    duration: float = ...,
    tween: Callable[[float], float] = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
) -> None: ...
def scroll(
    clicks: float,
    x: _NormalizeableXArg | None = ...,
    y: SupportsInt | None = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
) -> None: ...
def hscroll(
    clicks: float,
    x: _NormalizeableXArg | None = ...,
    y: SupportsInt | None = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
) -> None: ...
def vscroll(
    clicks: float,
    x: _NormalizeableXArg | None = ...,
    y: SupportsInt | None = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
) -> None: ...
def moveTo(
    x: _NormalizeableXArg | None = ...,
    y: SupportsInt | None = ...,
    duration: float = ...,
    tween: Callable[[float], float] = ...,
    logScreenshot: bool = ...,
    _pause: bool = ...,
) -> None: ...
def moveRel(
    xOffset: _NormalizeableXArg | None = ...,
    yOffset: SupportsInt | None = ...,
    duration: float = ...,
    tween: Callable[[float], float] = ...,
    logScreenshot: bool = ...,
    _pause: bool = ...,
) -> None: ...

move = moveRel

def dragTo(
    x: _NormalizeableXArg | None = ...,
    y: SupportsInt | None = ...,
    duration: float = ...,
    tween: Callable[[float], float] = ...,
    # Docstring says `button` can also be `int`, but `.lower()` is called unconditionally in `_normalizeButton()`
    button: str = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
    mouseDownUp: bool = ...,
) -> None: ...
def dragRel(
    xOffset: _NormalizeableXArg | None = ...,
    yOffset: SupportsInt | None = ...,
    duration: float = ...,
    tween: Callable[[float], float] = ...,
    # Docstring says `button` can also be `int`, but `.lower()` is called unconditionally in `_normalizeButton()`
    button: str = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
    mouseDownUp: bool = ...,
) -> None: ...

drag = dragRel

def isValidKey(key: str) -> bool: ...
def keyDown(key: str, logScreenshot: bool | None = ..., _pause: bool = ...) -> None: ...
def keyUp(key: str, logScreenshot: bool | None = ..., _pause: bool = ...) -> None: ...
def press(
    keys: str | Iterable[str],
    presses: SupportsIndex = ...,
    interval: float = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
) -> None: ...
def hold(
    keys: str | Iterable[str], logScreenshot: bool | None = ..., _pause: bool = ...
) -> contextlib._GeneratorContextManager[None]: ...
def typewrite(
    message: str | Sequence[str], interval: float = ..., logScreenshot: bool | None = ..., _pause: bool = ...
) -> None: ...

write = typewrite

def hotkey(*args: str, logScreenshot: bool | None = ..., interval: float = ...) -> None: ...
def failSafeCheck() -> None: ...
def displayMousePosition(xOffset: float = ..., yOffset: float = ...) -> None: ...
def sleep(seconds: float) -> None: ...
def countdown(seconds: SupportsIndex) -> None: ...
def run(commandStr: str, _ssCount: Sequence[int] | None = ...) -> None: ...
def printInfo(dontPrint: bool = ...) -> str: ...
def getInfo() -> tuple[str, str, str, str, Size, datetime]: ...
