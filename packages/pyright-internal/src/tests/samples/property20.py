# This sample tests deprecation reporting for overloaded property setters.

from typing import overload
from typing_extensions import deprecated


class A:
    @property
    def t1(self) -> int: ...

    @t1.setter
    @overload
    @deprecated("Setting t1 to None is deprecated")
    def t1(self, value: None) -> None: ...

    @t1.setter
    @overload
    def t1(self, value: int) -> None: ...

    @t1.setter
    def t1(self, value: int | None) -> None: ...


a = A()

# This should be marked deprecated because it resolves to the
# deprecated setter overload.
a.t1 = None

# This should not be marked deprecated.
a.t1 = 1
