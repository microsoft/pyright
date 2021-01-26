# This sample tests the isinstance narrowing when the list
# of classes includes a type defined by a type variable.

from typing import Any, Literal, Type, TypeVar

T = TypeVar("T")


def g(cls: Type[T], obj: Any) -> T:
    assert isinstance(obj, cls)
    reveal_type(obj)
    return obj


t1: Literal["int"] = reveal_type(g(int, 3))
