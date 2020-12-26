# This sample tests the instantiation of classes via a constructor
# when the type of the class is a TypeVar.

from typing import Literal, Type, TypeVar


class Foo:
    def __init__(self, a: int, b: str):
        pass


_TFoo = TypeVar("_TFoo", bound=Foo)


def func1(cls: Type[_TFoo]) -> _TFoo:
    # This should generate an error
    y = cls()

    x = cls(1, "")
    t1: Literal["_TFoo@func1"] = reveal_type(x)
    return x


_T = TypeVar("_T")


def func2(cls: Type[_T]) -> _T:
    # This should generate an error
    y = cls(1, "")

    x = cls()
    t1: Literal["_T@func2"] = reveal_type(x)
    return x
