# This sample tests the handling of a constrained TypeVar used with
# a Type[T] annotation.

from typing import TypeVar, Any


class A:
    def __init__(self, x: Any) -> None:
        pass

    def f(self) -> None:
        pass


T = TypeVar("T", str, int, A)


def factory(desired_type: type[T]) -> T:
    return desired_type(1)


factory(str)
reveal_type(factory(str), expected_text="str")

factory(int)
reveal_type(factory(int), expected_text="int")

factory(A).f()
reveal_type(factory(A), expected_text="A")

# This should generate an error
factory(float)
