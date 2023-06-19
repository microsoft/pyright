# This sample tests the handling of a property that's defined
# with a generic type for the "self" parameter.

from typing import TypeVar


_P = TypeVar("_P", bound=str)


class Foo(str):
    @property
    def parent(self: _P) -> _P:
        ...


p = Foo().parent
reveal_type(p, expected_text="Foo")
