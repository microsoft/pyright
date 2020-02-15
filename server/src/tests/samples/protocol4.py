# This sample tests that instance and class variables
# assigned within a Protocol method are flagged as errors.

from typing import List, Protocol

class Template(Protocol):
    def method(self) -> None:
        # This should be an error
        self.temp: List[int] = []

    @classmethod
    def cls_method(cls) -> None:
        # This should be an error
        cls.test2 = 3


