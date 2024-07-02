# This sample tests keyword-only class pattern matching for
# dataclasses.

from dataclasses import dataclass, field


@dataclass
class Point:
    optional: int | None = field(default=None, kw_only=True)
    x: int
    y: int


obj = Point(1, 2)
match obj:
    case Point(x, y, optional=opt):
        reveal_type(x, expected_text="int")
        reveal_type(y, expected_text="int")
        reveal_type(opt, expected_text="int | None")
        distance = (x**2 + y**2) ** 0.5
