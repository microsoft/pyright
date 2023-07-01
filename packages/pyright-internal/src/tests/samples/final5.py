# This sample tests that instance variables declared as Final within
# a dataclass do not need to have an explicit assignment because
# the generated __init__ method will assign them.

from dataclasses import dataclass
from typing import Final


class ClassA:
    x: Final[int]

    def __init__(self, x: int) -> None:
        self.x = x


@dataclass
class ClassB:
    x: Final[int]
