# This sample tests the instantiation of classes via a constructor
# when the type of the class is a TypeVar.

from typing import Type, TypeVar


class Foo:
    def __init__(self, a: int, b: str):
        pass


_TFoo = TypeVar("_TFoo", bound=Foo)


def func1(cls: Type[_TFoo]) -> _TFoo:
    # This should generate an error
    y = cls()

    x = cls(1, "")
    reveal_type(x, expected_text="_TFoo@func1")
    return x


_T = TypeVar("_T")


def func2(cls: Type[_T]) -> _T:
    # This should generate an error
    y = cls(1, "")

    x = cls()
    reveal_type(x, expected_text="_T@func2")
    return x
