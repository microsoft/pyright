# This sample tests keyword-only class pattern matching for
# dataclasses.

from dataclasses import dataclass, field
from typing import Literal

@dataclass
class Point:
    optional: int | None = field(default=None, kw_only=True)
    x: int
    y: int


obj = Point(1, 2)
match obj:
    case Point(x, y, optional=opt):
        t_v1: Literal["int"] = reveal_type(x)
        t_v2: Literal["int"] = reveal_type(y)
        t_v3: Literal["int | None"] = reveal_type(opt)
        distance = (x ** 2 + y ** 2) ** 0.5