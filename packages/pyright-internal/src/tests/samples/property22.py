# This sample tests a property setter that has exactly one @overload
# signature plus an implementation. This is the edge case where the
# synthesized __set__ has a single overload signature.

from typing import overload


class A:
    @property
    def t1(self) -> int: ...

    @t1.setter
    @overload
    def t1(self, value: int) -> None: ...

    @t1.setter
    def t1(self, value: str) -> None: ...


a = A()

reveal_type(a.t1, expected_text="int")

# This should not generate an error because it matches the single
# setter overload signature.
a.t1 = 1

# This should generate an error because str matches only the setter
# implementation, which is not counted as an overload signature.
a.t1 = "str"
