from typing import Literal, assert_type, reveal_type
reveal_type(0)
a: tuple[int] = (1,)
a = a
b: tuple[int] = (2,)
assert_type(a < b, bool)
assert a < b
