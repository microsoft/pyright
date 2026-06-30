# This sample tests support for overloads on property setters.

from typing import overload


class A:
    @property
    def t1(self) -> int: ...

    @t1.setter
    @overload
    def t1(self, value: int) -> None: ...

    @t1.setter
    @overload
    def t1(self, value: None) -> None: ...

    @t1.setter
    def t1(self, value: str) -> None: ...

    @t1.deleter
    def t1(self) -> None: ...


a = A()

reveal_type(a.t1, expected_text="int")

# These should not generate errors because they match
# the setter overloads.
a.t1 = 1
a.t1 = None

# This should generate an error because str does not match
# any of the setter overloads.
a.t1 = "str"

# The deleter is defined, so this should not generate an error.
del a.t1
