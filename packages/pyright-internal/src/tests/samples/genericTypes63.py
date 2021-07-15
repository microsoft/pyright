# This sample tests the handling of a constrained TypeVar used with
# a Type[T] annotation.

from typing import Literal, Type, TypeVar, Any


class A:
    def __init__(self, x: Any) -> None:
        pass

    def f(self) -> None:
        pass


T = TypeVar("T", str, int, A)


def factory(desired_type: Type[T]) -> T:
    return desired_type(1)


factory(str)
t1: Literal["str"] = reveal_type(factory(str))

factory(int)
t2: Literal["int"] = reveal_type(factory(int))

factory(A).f()
t3: Literal["A"] = reveal_type(factory(A))

# This should generate an error
factory(float)

