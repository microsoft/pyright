# This sample tests support for PEP 696 (default types for TypeVars)
# when used to define generic functions and with defaults type
# expressions that refer to other type variables.

from typing import Generic, Self
from typing_extensions import TypeVar  # pyright: ignore[reportMissingModuleSource]

T1 = TypeVar("T1", default=str)
T2 = TypeVar("T2", default=list[T1])


def func1(x: T1, y: int | T2 = 0) -> T2 | list[T1]: ...


v1_1 = func1("hi", 3.4)
reveal_type(v1_1, expected_text="float | list[str]")

v1_2 = func1("")
reveal_type(v1_2, expected_text="list[str]")


# This should generate an error because T1 depends on T2.
def func2(x: T2, y: T1) -> list[T1 | T2]: ...


T3 = TypeVar("T3", default=int)


class ClassA(Generic[T3]):
    def __init__(self, value: T3):
        self.value = value

    def func1(self, value: T3) -> Self:
        self.value = value
        return self
