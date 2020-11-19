# This sample tests the handling of the @dataclass decorator
# with a custom __init__.

from dataclasses import dataclass
from typing import Literal


@dataclass(init=False)
class A:
    x: int
    x_squared: int

    def __init__(self, x: int):
        self.x = x
        self.x_squared = x ** 2


a = A(3)


@dataclass(init=True)
class B:
    x: int
    x_squared: int

    def __init__(self, x: int):
        self.x = x
        self.x_squared = x ** 2


b = B(3)


@dataclass()
class C:
    x: int
    x_squared: int

    def __init__(self, x: int):
        self.x = x
        self.x_squared = x ** 2


c = C(3)


@dataclass(init=False)
class D:
    x: int
    x_squared: int


# This should generate an error because there is no
# override __init__ method and no synthesized __init__.
d = D(3)


@dataclass(eq=False)
class E:
    x: int

    def __eq__(self, x: "E") -> float:
        return 1.23


foo1 = E(3) == E(3)
t1: Literal["float"] = reveal_type(foo1)


@dataclass(order=False)
class F:
    x: int

    def __lt__(self, x: "F") -> float:
        return 1.23


foo2 = F(3) < F(3)
t1: Literal["float"] = reveal_type(foo2)
