# This sample tests the assignment of protocols that
# include property declarations.

from _typeshed import DataclassInstance
from dataclasses import dataclass
from typing import (
    ClassVar,
    ContextManager,
    Final,
    Generic,
    NamedTuple,
    Protocol,
    Sequence,
    TypeVar,
)


class Class1(Protocol):
    @property
    def batch_shape(self) -> int:
        return 0


class MockClass1:
    def __init__(self, batch_shape: int):
        self._batch_shape = batch_shape

    @property
    def batch_shape(self) -> int:
        return self._batch_shape


# This should not generate an error.
d: Class1 = MockClass1(batch_shape=1)


class Class2(Protocol):
    @property
    def batch_shape(self) -> int:
        return 0


class MockClass2:
    def __init__(self, batch_shape: int):
        self._batch_shape = batch_shape

    @property
    def batch_shape(self) -> float:
        return self._batch_shape


# This should generate an error because the
# type of the batch_shape property is not compatible.
e: Class2 = MockClass2(batch_shape=1)


class Class3(Protocol):
    @property
    def batch_shape(self) -> int:
        return 0

    @batch_shape.setter
    def batch_shape(self, value: int) -> None:
        pass


class MockClass3:
    def __init__(self, batch_shape: int):
        self._batch_shape = batch_shape

    @property
    def batch_shape(self) -> int:
        return self._batch_shape


# This should generate an error because it is missing
# a setter.
f: Class3 = MockClass3(batch_shape=1)


class Class4(Protocol):
    @property
    def batch_shape(self) -> int:
        return 0

    @batch_shape.deleter
    def batch_shape(self) -> None:
        pass


class MockClass4:
    def __init__(self, batch_shape: int):
        self._batch_shape = batch_shape

    @property
    def batch_shape(self) -> int:
        return self._batch_shape

    @batch_shape.setter
    def batch_shape(self, value: int) -> None:
        pass


# This should generate an error because it is missing
# a deleter.
g: Class4 = MockClass4(batch_shape=1)


_T_co = TypeVar("_T_co", covariant=True)
_Self = TypeVar("_Self")


class Class5:
    @property
    def real(self: _Self) -> _Self: ...


class MockClass5(Protocol[_T_co]):
    @property
    def real(self) -> _T_co: ...


foo5 = Class5()
h: MockClass5[Class5] = foo5


P6 = TypeVar("P6", bound="MockClass6")
C6 = TypeVar("C6", bound="Class6")


class MockClass6(Protocol):
    @property
    def bar(self: P6) -> ContextManager[P6]: ...


class Class6:
    @property
    def bar(self: C6) -> ContextManager[C6]: ...


i: MockClass6 = Class6()


class Proto7(Protocol):
    x: str


class Class7(NamedTuple):
    x: str


# This should generate an error because the protocol
# indicates that 'a' must be writable.
a: Proto7 = Class7("")


class Proto8(Protocol):
    @property
    def x(self) -> str: ...


class Class8(NamedTuple):
    x: str


b: Proto8 = Class8("")


class Proto9(Protocol):
    @property
    def x(self) -> str: ...

    @x.setter
    def x(self, n: str) -> None: ...


class Proto10(Protocol):
    x: str


class NT9(NamedTuple):
    x: str = ""


@dataclass(frozen=False)
class DC9:
    x: str = ""


@dataclass(frozen=True)
class DCFrozen9:
    x: str = ""


# This should generate an error because named tuple
# attributes are immutable.
p9_1: Proto9 = NT9()

# This should generate an error because frozen dataclass
# attributes are immutable.
p9_2: Proto9 = DCFrozen9()

p9_3: Proto9 = DC9()

# This should generate an error because named tuple
# attributes are immutable.
p10_1: Proto10 = NT9()

# This should generate an error because frozen dataclass
# attributes are immutable.
p10_2: Proto10 = DCFrozen9()

p10_3: Proto10 = DC9()


class Proto11(Protocol):
    val1: ClassVar[Sequence[int]]


class Concrete11:
    val1: Sequence[int]


# This should generate an error because of a ClassVar mismatch.
p11_1: Proto11 = Concrete11()


class Proto12(Protocol):
    val1: list[int]


class Concrete12:
    val1: ClassVar = [1, 2, 3]


# This should generate an error because of a ClassVar mismatch.
p12_1: Proto12 = Concrete12()


def func12(p11: Proto11, p12: Proto12):
    # This should generate an error because of a ClassVar mismatch.
    v1: Proto12 = p11

    # This should generate an error because of a ClassVar mismatch.
    v2: Proto11 = p12


T13 = TypeVar("T13", covariant=True)


class Proto13(Protocol[T13]):
    @property
    def prop1(self) -> T13: ...


class Proto14(Proto13[T13], Protocol): ...


class Concrete14(Generic[T13]):
    def __init__(self, val: T13):
        self.prop1 = val


def func14(val: Proto14[T13]): ...


func14(Concrete14(1))


class Proto15(Protocol):
    @property
    def prop1(self) -> int:
        return 0


class Concrete15_1:
    prop1: Final[int] = 0


class Concrete15_2:
    prop1: int = 0


class Concrete15_3:
    prop1: int

    def __init__(self):
        self.prop1 = 0


@dataclass
class Concrete15_4:
    prop1: Final[int] = 0


@dataclass(frozen=True)
class Concrete15_5:
    prop1: int = 0


# This should generate an error because it is not a ClassVar in the protocol.
p15_1: Proto15 = Concrete15_1()

p15_2: Proto15 = Concrete15_2()
p15_3: Proto15 = Concrete15_3()

p15_4_1: Proto15 = Concrete15_4()
p15_4_2: DataclassInstance = Concrete15_4()

p15_5_1: Proto15 = Concrete15_5()
p15_5_2: DataclassInstance = Concrete15_5()


class Proto16(Protocol):
    __name__: str


class Concrete16_1(NamedTuple):
    other: int


@dataclass(frozen=True)
class Concrete16_2:
    other: int


p16_1: Proto16 = Concrete16_1
p16_2: Proto16 = Concrete16_2
