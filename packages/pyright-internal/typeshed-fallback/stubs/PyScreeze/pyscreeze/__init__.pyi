from _typeshed import Incomplete, StrOrBytesPath
from collections.abc import Callable, Generator
from typing import NamedTuple, SupportsFloat, TypeVar, overload
from typing_extensions import Literal, ParamSpec, SupportsIndex, TypeAlias

from PIL import Image

_Unused: TypeAlias = object
_P = ParamSpec("_P")
_R = TypeVar("_R")
# TODO: cv2.Mat is not available as a type yet:
# https://github.com/microsoft/python-type-stubs/issues/211
# https://github.com/microsoft/python-type-stubs/tree/main/cv2
# https://github.com/opencv/opencv/pull/20370
# cv2.Mat is just an alias for a numpy NDArray, but can't import that either.
# Because pyscreeze does not declare it as a dependency, stub_uploader won't let it.
_Mat: TypeAlias = Incomplete

useOpenCV: bool
RUNNING_PYTHON_2: Literal[False]
GRAYSCALE_DEFAULT: Literal[False]
USE_IMAGE_NOT_FOUND_EXCEPTION: bool
scrotExists: bool

class Box(NamedTuple):
    left: int
    top: int
    width: int
    height: int

class Point(NamedTuple):
    x: int
    y: int

class RGB(NamedTuple):
    red: int
    green: int
    blue: int

class PyScreezeException(Exception): ...
class ImageNotFoundException(PyScreezeException): ...

# _locateAll_opencv
def requiresPillow(wrappedFunction: Callable[_P, _R]) -> Callable[_P, _R]: ...
@overload
def locate(
    needleImage: str | Image.Image | _Mat,
    haystackImage: str | Image.Image | _Mat,
    *,
    grayscale: bool | None = ...,
    limit: _Unused = ...,
    region: tuple[int, int, int, int] | None = ...,
    step: int = ...,
    confidence: SupportsFloat | SupportsIndex | str = ...,
) -> Box | None: ...

# _locateAll_python / _locateAll_pillow
@overload
def locate(
    needleImage: str | Image.Image,
    haystackImage: str | Image.Image,
    *,
    grayscale: bool | None = ...,
    limit: _Unused = ...,
    region: tuple[int, int, int, int] | None = ...,
    step: int = ...,
    confidence: None = ...,
) -> Box | None: ...

# _locateAll_opencv
@overload
def locateOnScreen(
    image: str | Image.Image | _Mat,
    minSearchTime: float = ...,
    *,
    grayscale: bool | None = ...,
    limit: _Unused = ...,
    region: tuple[int, int, int, int] | None = ...,
    step: int = ...,
    confidence: SupportsFloat | SupportsIndex | str = ...,
) -> Box | None: ...

# _locateAll_python / _locateAll_pillow
@overload
def locateOnScreen(
    image: str | Image.Image,
    minSearchTime: float = ...,
    *,
    grayscale: bool | None = ...,
    limit: _Unused = ...,
    region: tuple[int, int, int, int] | None = ...,
    step: int = ...,
    confidence: None = ...,
) -> Box | None: ...

# _locateAll_opencv
@overload
def locateAllOnScreen(
    image: str | Image.Image | _Mat,
    *,
    grayscale: bool | None = ...,
    limit: int = ...,
    region: tuple[int, int, int, int] | None = ...,
    step: int = ...,
    confidence: SupportsFloat | SupportsIndex | str = ...,
) -> Generator[Box, None, None]: ...

# _locateAll_python / _locateAll_pillow
@overload
def locateAllOnScreen(
    image: str | Image.Image,
    *,
    grayscale: bool | None = ...,
    limit: int | None = ...,
    region: tuple[int, int, int, int] | None = ...,
    step: int = ...,
    confidence: None = ...,
) -> Generator[Box, None, None]: ...

# _locateAll_opencv
@overload
def locateCenterOnScreen(
    image: str | Image.Image | _Mat,
    *,
    minSearchTime: float,
    grayscale: bool | None = ...,
    limit: _Unused = ...,
    region: tuple[int, int, int, int] | None = ...,
    step: int = ...,
    confidence: SupportsFloat | SupportsIndex | str = ...,
) -> Point | None: ...

# _locateAll_python / _locateAll_pillow
@overload
def locateCenterOnScreen(
    image: str | Image.Image,
    *,
    minSearchTime: float,
    grayscale: bool | None = ...,
    limit: _Unused = ...,
    region: tuple[int, int, int, int] | None = ...,
    step: int = ...,
    confidence: None = ...,
) -> Point | None: ...

# _locateAll_opencv
@overload
def locateOnWindow(
    image: str | Image.Image | _Mat,
    title: str,
    *,
    grayscale: bool | None = ...,
    limit: _Unused = ...,
    step: int = ...,
    confidence: SupportsFloat | SupportsIndex | str = ...,
) -> Box | None: ...

# _locateAll_python / _locateAll_pillow
@overload
def locateOnWindow(
    image: str | Image.Image,
    title: str,
    *,
    grayscale: bool | None = ...,
    limit: _Unused = ...,
    step: int = ...,
    confidence: None = ...,
) -> Box | None: ...
def showRegionOnScreen(region: tuple[int, int, int, int], outlineColor: str = ..., filename: str = ...) -> None: ...
def center(coords: tuple[int, int, int, int]) -> Point: ...
def pixelMatchesColor(
    x: int, y: int, expectedRGBColor: tuple[int, int, int] | tuple[int, int, int, int], tolerance: int = ...
) -> bool: ...
def pixel(x: int, y: int) -> tuple[int, int, int]: ...
def screenshot(imageFilename: StrOrBytesPath | None = ..., region: tuple[int, int, int, int] | None = ...) -> Image.Image: ...

grab = screenshot
# _locateAll_opencv
@overload
def locateAll(
    needleImage: str | Image.Image | _Mat,
    haystackImage: str | Image.Image | _Mat,
    grayscale: bool | None = ...,
    limit: int = ...,
    region: tuple[int, int, int, int] | None = ...,
    step: int = ...,
    confidence: SupportsFloat | SupportsIndex | str = ...,
) -> Generator[Box, None, None]: ...

# _locateAll_python / _locateAll_pillow
@overload
def locateAll(
    needleImage: str | Image.Image,
    haystackImage: str | Image.Image,
    grayscale: bool | None = ...,
    limit: int | None = ...,
    region: tuple[int, int, int, int] | None = ...,
    step: int = ...,
    confidence: None = ...,
) -> Generator[Box, None, None]: ...
