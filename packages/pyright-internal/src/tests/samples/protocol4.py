# This sample tests that instance and class variables
# assigned within a Protocol method are flagged as errors.

from typing import ClassVar, List, Protocol


class ProtoA(Protocol):
    a: int
    b: ClassVar[str]

    def method(self) -> None:
        self.a = 3

        # This should be an error
        self.temp: List[int] = []

    @classmethod
    def cls_method(cls) -> None:
        cls.b = "3"

        # This should be an error
        cls.test2 = 3

class ProtoB(Protocol):
    x: ClassVar[int]

class B:
    x: int

# This should generate an error because x is not a ClassVar in B.
a: ProtoB = B()

 