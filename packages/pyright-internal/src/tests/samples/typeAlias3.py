# This sample tests that type aliases can consist of
# partially-specialized classes that can be further
# specialized.

# pyright: strict

from typing import Callable, Generic, Tuple, Optional, TypeVar
from typing_extensions import ParamSpec

T = TypeVar("T")
P = ParamSpec("P")

ValidationResult = Tuple[bool, Optional[T]]


def foo() -> ValidationResult[str]:
    return False, "valid"


class ClassA(Generic[T]):
    def __new__(cls, value: T) -> "ClassA[T]":
        ...


TypeAliasA = ClassA[T]

a1 = ClassA(3.0)
reveal_type(a1, expected_text="ClassA[float]")

a2 = TypeAliasA(3.0)
reveal_type(a2, expected_text="ClassA[float]")

Func = Callable[P, T]
AnyFunc = Func[P, int]
AnyFunc[P]
