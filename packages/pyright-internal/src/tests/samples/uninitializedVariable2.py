# This sample tests the reportUninitializedInstanceVariable when applied
# to a concrete implementation of an abstract base class that defines
# (but does not assign) variables.

from abc import ABC
from typing import NamedTuple, final


class Abstract1(ABC):
    x: str


@final
# This should generate an error because x is unimplemented.
class A(Abstract1):
    pass


class B(Abstract1):
    pass


@final
class C(Abstract1):
    x = ""


@final
class D(Abstract1):
    def __init__(self):
        self.x = ""


class Abstract2(Abstract1):
    y: str


@final
# This should generate an error because x and y are unimplemented.
class E(Abstract2):
    pass


class Abstract3(Abstract1):
    x = ""


@final
class G(Abstract3):
    pass


class H(NamedTuple):
    x: int
