import contextlib
from collections.abc import Callable, Generator, Iterable, Sequence
from datetime import datetime
from typing import NamedTuple, TypeVar, overload
from typing_extensions import ParamSpec

# from pyscreeze import Box

class PyAutoGUIException(Exception): ...
class FailSafeException(PyAutoGUIException): ...
class ImageNotFoundException(PyAutoGUIException): ...

_P = ParamSpec("_P")
_R = TypeVar("_R")

# TODO: Complete types with pyscreeze once we can import it as a type dependency
# Actually `pyscreeze.Box`, but typeshed doesn't currently have stubs for pyscreeze
# (and the library doesn't have type annotations either)

class _Box(NamedTuple):
    left: int
    top: int
    width: int
    height: int

def raisePyAutoGUIImageNotFoundException(wrappedFunction: Callable[_P, _R]) -> Callable[_P, _R]: ...

# These functions reuse pyscreeze functions directly. See above TODO.
def locate(*args, **kwargs) -> _Box | None: ...
def locateAll(*args, **kwargs) -> Generator[_Box, None, None]: ...
def locateAllOnScreen(*args, **kwargs) -> Generator[_Box, None, None]: ...
def locateCenterOnScreen(*args, **kwargs) -> Point | None: ...
def locateOnScreen(*args, **kwargs) -> _Box | None: ...
def locateOnWindow(*args, **kwargs) -> _Box | None: ...
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
@overload
def onScreen(x: tuple[float, float], y: None = ...) -> bool: ...
@overload
def onScreen(x: float, y: float) -> bool: ...
def mouseDown(
    x: float | Sequence[float] | str | None = ...,
    y: float | None = ...,
    # Docstring says `button` can also be `int`, but `.lower()` is called unconditionally in `_normalizeButton()`
    button: str = ...,
    duration: float = ...,
    tween: Callable[[float], float] = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
) -> None: ...
def mouseUp(
    x: float | Sequence[float] | str | None = ...,
    y: float | None = ...,
    # Docstring says `button` can also be `int`, but `.lower()` is called unconditionally in `_normalizeButton()`
    button: str = ...,
    duration: float = ...,
    tween: Callable[[float], float] = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
) -> None: ...
def click(
    x: float | Sequence[float] | str | None = ...,
    y: float | None = ...,
    clicks: int = ...,
    interval: float = ...,
    # Docstring says `button` can also be `int`, but `.lower()` is called unconditionally in `_normalizeButton()`
    button: str = ...,
    duration: float = ...,
    tween: Callable[[float], float] = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
) -> None: ...
def leftClick(
    x: float | Sequence[float] | str | None = ...,
    y: float | None = ...,
    interval: float = ...,
    duration: float = ...,
    tween: Callable[[float], float] = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
) -> None: ...
def rightClick(
    x: float | Sequence[float] | str | None = ...,
    y: float | None = ...,
    interval: float = ...,
    duration: float = ...,
    tween: Callable[[float], float] = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
) -> None: ...
def middleClick(
    x: float | Sequence[float] | str | None = ...,
    y: float | None = ...,
    interval: float = ...,
    duration: float = ...,
    tween: Callable[[float], float] = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
) -> None: ...
def doubleClick(
    x: float | Sequence[float] | str | None = ...,
    y: float | None = ...,
    interval: float = ...,
    # Docstring says `button` can also be `int`, but `.lower()` is called unconditionally in `_normalizeButton()`
    button: str = ...,
    duration: float = ...,
    tween: Callable[[float], float] = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
) -> None: ...
def tripleClick(
    x: float | Sequence[float] | str | None = ...,
    y: float | None = ...,
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
    x: float | Sequence[float] | str | None = ...,
    y: float | None = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
) -> None: ...
def hscroll(
    clicks: float,
    x: float | Sequence[float] | str | None = ...,
    y: float | None = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
) -> None: ...
def vscroll(
    clicks: float,
    x: float | Sequence[float] | str | None = ...,
    y: float | None = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
) -> None: ...
def moveTo(
    x: float | Sequence[float] | str | None = ...,
    y: float | None = ...,
    duration: float = ...,
    tween: Callable[[float], float] = ...,
    logScreenshot: bool = ...,
    _pause: bool = ...,
) -> None: ...
def moveRel(
    xOffset: float | Sequence[float] | str | None = ...,
    yOffset: float | None = ...,
    duration: float = ...,
    tween: Callable[[float], float] = ...,
    logScreenshot: bool = ...,
    _pause: bool = ...,
) -> None: ...

move = moveRel

def dragTo(
    x: float | Sequence[float] | str | None = ...,
    y: float | None = ...,
    duration: float = ...,
    tween: Callable[[float], float] = ...,
    # Docstring says `button` can also be `int`, but `.lower()` is called unconditionally in `_normalizeButton()`
    button: str = ...,
    logScreenshot: bool | None = ...,
    _pause: bool = ...,
    mouseDownUp: bool = ...,
) -> None: ...
def dragRel(
    xOffset: float | Sequence[float] | str = ...,
    yOffset: float = ...,
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
    keys: str | Iterable[str], presses: int = ..., interval: float = ..., logScreenshot: bool | None = ..., _pause: bool = ...
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
def countdown(seconds: int) -> None: ...
def run(commandStr: str, _ssCount: Sequence[int] | None = ...) -> None: ...
def printInfo(dontPrint: bool = ...) -> str: ...
def getInfo() -> tuple[str, str, str, str, Size, datetime]: ...
