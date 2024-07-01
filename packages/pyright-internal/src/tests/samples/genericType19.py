# This sample tests that a class that derives from Any can be used
# to satisfy a TypeVar.

from typing import Any, TypeVar


T = TypeVar("T")


def foo(self, obj: T, foo: Any) -> T:
    # NotImplemented is an instance of a class that derives from Any.
    return NotImplemented
