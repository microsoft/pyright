# This sample tests that type aliases can consist of
# partially-specialized classes that can be further
# specialized.

# pyright: reportMissingModuleSource=false

from typing import Callable, Generic, Optional
from typing_extensions import ParamSpec, TypeVar

T = TypeVar("T")
P = ParamSpec("P")
TStr = TypeVar("TStr", default=str)

ValidationResult = tuple[bool, Optional[T]]


def foo() -> ValidationResult[str]:
    return False, "valid"


class ClassA(Generic[T]):
    def __new__(cls, value: T) -> "ClassA[T]": ...


TypeAliasA1 = ClassA[T]

a1 = ClassA(3.0)
reveal_type(a1, expected_text="ClassA[float]")

a2 = TypeAliasA1(3)
reveal_type(a2, expected_text="ClassA[Unknown]")

a3 = TypeAliasA1[int](3)
reveal_type(a3, expected_text="ClassA[int]")


TypeAliasA2 = ClassA[TStr]

# This should generate an error.
b1 = TypeAliasA2(1)

b2 = TypeAliasA2("")
reveal_type(b2, expected_text="ClassA[str]")

b3 = TypeAliasA2[float](1.0)
reveal_type(b3, expected_text="ClassA[float]")

Func = Callable[P, T]
AnyFunc = Func[P, int]
x: AnyFunc[...]
