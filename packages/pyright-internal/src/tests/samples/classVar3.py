# This sample tests the reporting of errors for ClassVar in contexts
# where it is not allowed.

from typing import ClassVar, Final, List

# This should generate an error.
x: ClassVar[int] = 3


class Foo:
    x: ClassVar[int] = 3

    # This should generate an error.
    y: Final[ClassVar[int]] = 3

    # This should generate an error.
    z: List[ClassVar[int]] = []

    # This should generate an error.
    def func1(self, a: ClassVar[int]):
        # This should generate an error.
        x: ClassVar[str] = ""

        # This should generate an error.
        self.xx: ClassVar[str] = ""

    # This should generate an error.
    def func2(self) -> ClassVar[int]:
        return 3