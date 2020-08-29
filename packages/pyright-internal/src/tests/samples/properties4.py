# This sample tests the handling of a property that's defined
# with a generic type for the "self" parameter.

from typing import TypeVar


_P = TypeVar('_P', bound=str)

class Foo(str):
    @property
    def parent(self: _P) -> _P: ...

def requires_foo(a: Foo):
    pass

p = Foo().parent
requires_foo(p)
