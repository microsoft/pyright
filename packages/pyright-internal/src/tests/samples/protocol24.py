# This sample tests the provision in PEP 544 where a class type can
# be assigned to a protocol.

from typing import Any, Callable, ClassVar, Protocol


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


class ProtoH(Protocol):
    attr1: int


class ProtoI(Protocol):
    __name__: int


class ConcreteH:
    attr1: ClassVar[int] = 1

    @classmethod
    def method1(cls: ProtoH) -> int:
        return cls.attr1


class SinkH[T](Protocol):
    def send(self, x: T, /) -> None: ...


def func1(cls: ProtoH, /) -> int: ...


def func2(cls: ProtoI, /) -> int: ...


def func3[T](c: Callable[[type[T]], int]) -> T: ...


def func4[T](c: Callable[[type[T]], int], t: type[T]) -> T: ...


def func5[T](s: SinkH[type[T]]) -> T: ...


def func6[T](s: SinkH[type[T]], t: type[T]) -> T: ...


def func7():
    func3(func1)
    func4(func1, ConcreteH)


def func8():
    # This should generate an error.
    func3(func2)

    # This should generate an error.
    func4(func1, int)


def func9(s: SinkH[ProtoH]):
    func5(s)
    func6(s, ConcreteH)


def func10(s1: SinkH[ProtoH], s2: SinkH[ProtoI]):
    # This should generate an error.
    func5(s2)

    # This should generate an error.
    func6(s1, int)


class ProtoJ[T](Protocol):
    @property
    def __name__(self) -> T: ...


def func11(cls: ProtoJ[ProtoH], /) -> int: ...


def func12():
    # This should generate an error.
    func3(func11)
