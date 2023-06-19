# This sample tests that an attempt to use multiple inheritance
# with a NamedTuple will result in an error.

from typing import Generic, NamedTuple, TypeVar


# This should generate an error.
class A(NamedTuple, object):
    x: int


T = TypeVar("T")


class B(NamedTuple, Generic[T]):
    x: int
