# This sample tests the specialization of property return types.

from typing import TypeVar, Generic

T = TypeVar('T')

class Foo(Generic[T]):

    def __init__(self, bar: T):
        self._bar = bar

    @property
    def bar(self) -> T:
        return self._bar

    def bar_method(self) -> T:
        return self._bar


foo = Foo[int](3)

# This should work fine because foo.bar should be an int
foo.bar.bit_length()
