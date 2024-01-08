# This sample tests that instance and class variables
# assigned within a Protocol method are flagged as errors.

from typing import ClassVar, Protocol


class ProtoA(Protocol):
    a: int
    b: ClassVar[str]

    def method(self) -> None:
        self.a = 3

        # This should be an error
        self.temp: list[int] = []

    @classmethod
    def cls_method(cls) -> None:
        cls.b = "3"

        # This should be an error
        cls.test2 = 3


class ProtoB(Protocol):
    x: ClassVar[int]


class B:
    x: int


# This should generate an error because x is not a ClassVar in B
# but is a ClassVar in the protocol.
b: ProtoB = B()


class ProtoC(Protocol):
    x: ClassVar[int]


class C:
    def __init__(self):
        self.x: int = 0


# This should generate an error because x is an instance-only variable
# and doesn't satisfy the ClassVar annotation in the protocol.
c: ProtoC = C()
