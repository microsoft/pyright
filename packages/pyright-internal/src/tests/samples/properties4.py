# This sample tests the handling of a property that's defined
# with a generic type for the "self" parameter.

from typing import Literal, TypeVar


_P = TypeVar("_P", bound=str)


class Foo(str):
    @property
    def parent(self: _P) -> _P:
        ...


p = Foo().parent
t1: Literal["Foo"] = reveal_type(p)
