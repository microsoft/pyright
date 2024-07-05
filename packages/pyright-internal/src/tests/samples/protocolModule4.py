# This sample tests protocol matching for modules when using
# a generic protocol class.

from typing import Protocol, TypeVar

from . import protocolModule3
from .protocolModule3 import Fn

X = TypeVar("X", covariant=True)
Z = TypeVar("Z")


class FnHandler(Protocol[X]):
    def __call__(self, x: Fn[X]) -> None: ...


class ModuleSpec(Protocol[Z]):
    x: FnHandler[Z]


m1: ModuleSpec[int] = protocolModule3
m1.x(lambda y: None)

# This should generate an error.
m2: ModuleSpec[str] = protocolModule3
