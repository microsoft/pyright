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


T4 = TypeVar("T4", default=int)
T5 = TypeVar("T5", default=T4)


class ClassB(Generic[T4, T5]):
    @property
    def x(self) -> T4: ...

    @property
    def y(self) -> T5: ...


b1 = ClassB()
reveal_type(b1.x, expected_text="int")
reveal_type(b1.y, expected_text="int")


T6 = TypeVar("T6", default=int)
T7 = TypeVar("T7", default=T6)
T8 = TypeVar("T8", default=int | None)


class ClassC(Generic[T6, T7, T8]):
    def __new__(cls, x: T7, /) -> Self: ...

    def method1(self) -> T7: ...
