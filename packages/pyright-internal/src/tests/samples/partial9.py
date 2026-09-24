# This sample tests functools.partial with callable class instances (objects with __call__).

from functools import partial
from typing import overload

class CallableClass:
    def __call__(self, a: int, b: str, c: float = 1.0) -> bool:
        return True

c = CallableClass()
p1 = partial(c, 1)
reveal_type(p1("hello"), expected_text="bool")
reveal_type(p1("hello", c=2.0), expected_text="bool")

# This should generate an error because 'b' must be a str
p1(123)

# This should generate an error because 'c' must be a float
p1("hello", c="invalid")


class OverloadedCallable:
    @overload
    def __call__(self, a: int, b: int) -> int: ...
    @overload
    def __call__(self, a: str, b: str) -> str: ...
    def __call__(self, a: int | str, b: int | str) -> int | str:
        return a

oc = OverloadedCallable()
p2 = partial(oc, 1)
reveal_type(p2(2), expected_text="int")

# This should generate an error because second argument must be int
p2("invalid")
