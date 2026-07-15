# This sample documents a current limitation: override-compatibility
# checking is not performed for overloaded property accessors. A subclass
# that overrides an overloaded setter with an incompatible signature is
# not currently flagged by reportIncompatibleMethodOverride because the
# base-class accessor is represented as an OverloadedType, which the
# override-compatibility checks intentionally skip.

from typing import overload


class Base:
    @property
    def t1(self) -> int: ...

    @t1.setter
    @overload
    def t1(self, value: int) -> None: ...

    @t1.setter
    @overload
    def t1(self, value: None) -> None: ...

    @t1.setter
    def t1(self, value: int | None) -> None: ...


class Derived(Base):
    @property
    def t1(self) -> int: ...

    # If override-compatibility checking supported overloaded accessors,
    # this incompatible setter override would be flagged. It is currently
    # not reported (documented limitation); update this sample when that
    # support is added.
    @t1.setter
    def t1(self, value: str) -> None: ...
