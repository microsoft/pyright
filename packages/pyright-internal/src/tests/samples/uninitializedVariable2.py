# This sample tests the reportUninitializedInstanceVariable when applied
# to a concrete implementation of an abstract base class that defines
# (but does not assign) variables.

from abc import ABC, abstractmethod
from dataclasses import KW_ONLY, KW_ONLY as Separator, dataclass, field
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


@dataclass
class IAbstract(ABC):
    p1: str
    p2: int = field(init=False)

@final
@dataclass
# This should generate an error because p2 is uninitialized.
class I(IAbstract):
    p3: int


# KW_ONLY is a dataclass pseudo-field, not an instance variable.
# This should not generate an uninitialized-instance-variable error.
@dataclass
class JAbstract(ABC):
    _: KW_ONLY


@final
@dataclass
class J(JAbstract):
    required: int

# A shadowed KW_ONLY name must remain a real instance variable.
# Expected: one uninitialized-instance-variable diagnostic.
def check_shadowed_kw_only() -> None:
    class KW_ONLY:
        pass

    class KAbstract(ABC):
        token: KW_ONLY

    @final
    class K(KAbstract):
        pass


# A separator must not suppress an inherited real field.
# Expected: one uninitialized-instance-variable diagnostic.
@dataclass
class LAbstract(ABC):
    value: int = field(init=False)


@dataclass
class LMiddle(LAbstract):
    value: KW_ONLY  # pyright: ignore[reportIncompatibleVariableOverride]


@final
@dataclass
class L(LMiddle):
    pass


# The same inheritance case using an imported alias.
# Expected: one uninitialized-instance-variable diagnostic.
@dataclass
class MAbstract(ABC):
    _: int = field(init=False)


@dataclass
class MMiddle(MAbstract):
    _: Separator


@final
@dataclass
class M(MMiddle):
    pass
