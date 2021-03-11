# This sample tests that instance and class variables
# assigned within a Protocol method are flagged as errors.

from typing import ClassVar, List, Protocol

class Template(Protocol):
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


