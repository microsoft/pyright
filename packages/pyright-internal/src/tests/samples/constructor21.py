# This sample tests the instantiation of classes via a constructor
# when the type of the class is a TypeVar.

from typing import TypeVar


class ClassA:
    def __init__(self, a: int, b: str):
        pass


T_A = TypeVar("T_A", bound=ClassA)


def func1(cls: type[T_A]) -> T_A:
    # This should generate an error.
    y = cls()

    x = cls(1, "")
    reveal_type(x, expected_text="T_A@func1")
    return x


_T = TypeVar("_T")


def func2(cls: type[_T]) -> _T:
    # This should generate an error.
    y = cls(1, "")

    x = cls()
    reveal_type(x, expected_text="_T@func2")
    return x
