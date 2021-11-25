from dataclasses import dataclass, field

@dataclass
class Point:
    optional: int | None = field(default=None, kw_only=True)
    x: int
    y: int


obj = Point(1, 2)
match obj:
    case Point(x, y):
        a = reveal_type(x)
        b = reveal_type(y)