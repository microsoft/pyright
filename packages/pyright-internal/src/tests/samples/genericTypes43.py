# This sample tests that default parameter values can be assigned
# to types that are generic.

from typing import Generic, List, Type, TypeVar


class Foo:
    pass


_TFoo = TypeVar("_TFoo", bound=Foo)
_TAnything = TypeVar("_TAnything")


class Bar(Generic[_TFoo, _TAnything]):
    def __init__(
        self,
        p1: Type[_TFoo] = Foo,
        p2: List[_TAnything] = [],
        # This should generate an error.
        p3: List[_TFoo] = [2],
        p4: List[_TAnything] = [2],
    ):
        pass
