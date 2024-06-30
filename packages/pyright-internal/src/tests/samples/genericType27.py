# This sample tests the case where a type conditioned on a TypeVar
# is assigned to that same TypeVar in an invariant context.

from typing import TypeVar


class ClassA: ...


T = TypeVar("T", bound=ClassA)


def func1(cls: type[T]) -> list[type[T]]:
    result = [cls]
    for c in cls.__subclasses__():
        result.extend(func1(c))
    return result
