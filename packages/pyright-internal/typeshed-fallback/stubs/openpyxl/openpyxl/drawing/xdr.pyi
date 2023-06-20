from _typeshed import Incomplete
from typing import ClassVar

from .geometry import Point2D, PositiveSize2D, Transform2D

class XDRPoint2D(Point2D):
    namespace: ClassVar[None]  # type:ignore[assignment]
    x: Incomplete
    y: Incomplete

class XDRPositiveSize2D(PositiveSize2D):
    namespace: ClassVar[None]  # type:ignore[assignment]
    cx: Incomplete
    cy: Incomplete

class XDRTransform2D(Transform2D):
    namespace: ClassVar[None]  # type:ignore[assignment]
    rot: Incomplete
    flipH: Incomplete
    flipV: Incomplete
    off: Incomplete
    ext: Incomplete
    chOff: Incomplete
    chExt: Incomplete
