from typing import Literal, assert_type, reveal_type
reveal_type(0)
class A:
    def __lt__(self, other: object) -> Literal[True]: return True
a = A()
assert_type((a,) < (a,), bool)
assert ((a,) < (a,)) is False
