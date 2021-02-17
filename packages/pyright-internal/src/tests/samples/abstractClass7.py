# This sample verifies that Protocol classes are treated as
# abstract even though they don't derive from ABCMeta.

from typing import Protocol, Tuple
from abc import abstractmethod


class RGB(Protocol):
    rgb: Tuple[int, int, int]

    @abstractmethod
    def intensity(self) -> int:
        return 0


class Point(RGB):
    def __init__(self, red: int, green: int, blue: int) -> None:
        self.rgb = red, green, blue


# This should generate an error because "intensity" is not implemented.
p = Point(1, 2, 3)
