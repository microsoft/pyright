# This sample tests the specialization of a property
# provided by a generic subclass.

from typing import TypeVar, Generic

T = TypeVar("T", bound=int)


class Foo(Generic[T]):
    def __init__(self, bar: T):
        self._bar = bar

    @property
    def bar(self) -> T:
        return self._bar

    def bar_method(self) -> T:
        return self._bar


class NewInt(int):
    def new_thing(self):
        pass


class FooNewInt(Foo[NewInt]):
    def fizz(self) -> None:
        self.bar.new_thing()
        self.bar_method().new_thing()
