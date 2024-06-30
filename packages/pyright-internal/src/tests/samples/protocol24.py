# This sample tests the provision in PEP 544 where a class type can
# be assigned to a protocol.

from typing import Any, ClassVar, Protocol


class ProtoA(Protocol):
    def meth(_self, x: int) -> int: ...


class ProtoB(Protocol):
    def meth(_self, self: Any, x: int) -> int: ...


class C:
    def meth(self, x: int) -> int: ...


# This should generate an error because C.meth isn't compatible
# with ProtoA().meth.
a: ProtoA = C

b: ProtoB = C


class ProtoD(Protocol):
    var1: int

    @property
    def var2(self) -> str: ...


class E:
    var1: ClassVar[int]
    var2: ClassVar[str]


class F:
    var1: ClassVar[int]
    var2: ClassVar[int]


d: ProtoD = E

# This should generate an error because var2 is the wrong type.
e: ProtoD = F


class Jumps(Protocol):
    def jump(self) -> int: ...


class Jumper1:
    @classmethod
    def jump(cls) -> int: ...


class Jumper2:
    def jump(self) -> int: ...


def do_jump(j: Jumps):
    print(j.jump())


do_jump(Jumper1)
do_jump(Jumper2())


class ProtoG1(Protocol):
    attr1: ClassVar[int]


class ProtoG2(Protocol):
    attr1: int


class ConcreteG1:
    attr1: ClassVar[int] = 1


class ConcreteG2:
    attr1: int = 1


class GMeta(type):
    attr1: int


class ConcreteG3(metaclass=GMeta):
    pass


# The following four lines should generate an error.
pc1: ProtoG1 = ConcreteG1
pc2: ProtoG1 = ConcreteG2
pc3: ProtoG2 = ConcreteG2
pc4: ProtoG1 = ConcreteG3

pc5: ProtoG2 = ConcreteG1
pc6: ProtoG2 = ConcreteG3
