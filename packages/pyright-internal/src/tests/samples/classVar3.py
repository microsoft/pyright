# This sample tests the reporting of errors for ClassVar in contexts
# where it is not allowed.

from typing import Annotated, Any, ClassVar, Final, Generic, TypeAlias, TypeVar
from typing_extensions import Self  # pyright: ignore[reportMissingModuleSource]

# This should generate an error.
x: ClassVar[int] = 3

T = TypeVar("T")

# This should generate an error.
TA1: TypeAlias = ClassVar[str]


class Foo(Generic[T]):
    x: ClassVar[int] = 3

    # This should generate an error.
    y: Final[ClassVar[int]] = 3

    # This should generate an error.
    z: list[ClassVar[int]] = []

    # This should generate an error because TypeVars cannot
    # be used in a ClassVar.
    illegal1: ClassVar[list[T]]

    # This should generate an error because TypeVars cannot
    # be used in a ClassVar.
    illegal2: ClassVar[T]

    # This should generate an error because Final cannot be
    # used with a ClassVar.
    illegal3: ClassVar[Final] = 0

    # This should generate an error because Final cannot be
    # used with a ClassVar. A second error is generated because
    # Final[int] is not interpreted as a valid type.
    illegal4: ClassVar[Final[int]] = 0

    ok1: ClassVar[list]
    ok2: ClassVar[list[Any]]
    ok3: Annotated[ClassVar[list[Self]], ""]

    # This should generate an error.
    def func1(self, a: ClassVar[int]):
        # This should generate an error.
        x: ClassVar[str] = ""

        # This should generate an error.
        self.xx: ClassVar[str] = ""

    # This should generate an error.
    def func2(self) -> ClassVar[int]:
        return 3
