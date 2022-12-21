# This sample handles the case where a property setter contains
# a function-scoped TypeVar.

from typing import Hashable, TypeVar, Sequence

HashableT = TypeVar("HashableT", bound=Hashable)

class Foo:
    def __init__(self):
        self._something = []

    @property
    def something(self) -> Sequence[Hashable]:
        return self._something

    @something.setter
    def something(self, thing: list[HashableT]):
        self._something = thing


f = Foo()
f.something = ["a", "b", "c"]

