# This sample tests that a @deprecated marker on an overloaded property
# setter implementation propagates to all of the setter overloads, per PEP 702.

from typing import overload
from typing_extensions import deprecated


class A:
    @property
    def t1(self) -> int: ...

    @t1.setter
    @overload
    def t1(self, value: None) -> None: ...

    @t1.setter
    @overload
    def t1(self, value: int) -> None: ...

    @t1.setter
    @deprecated("Setting t1 is deprecated")
    def t1(self, value: int | None) -> None: ...


a = A()

# Both of these should be marked deprecated because the setter
# implementation is deprecated, which propagates to all overloads.
a.t1 = None
a.t1 = 1
