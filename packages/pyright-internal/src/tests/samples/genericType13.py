# This sample tests that various types can be assigned to Type[Any].

from typing import Any, Type, TypeVar


class ClassA: ...


T = TypeVar("T")


def func1(x: Type[Any], y: Type[T]) -> T:
    v1: Type[Any] = x
    v2: Type[Any] = ClassA
    v3: Type[Any] = y

    return y()
