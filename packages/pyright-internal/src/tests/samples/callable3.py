# This sample tests the case where a callable type contains a
# callable type as an input parameter, and the latter callable
# contains generic types.

from typing import Callable, Generic, TypeVar

T = TypeVar("T")
R = TypeVar("R")


class ClassA(Generic[R]): ...


class ClassB(Generic[T]):
    def method1(self, val: Callable[[ClassA[R]], T]) -> R | None:
        return None


b1: ClassB[tuple[int, ClassA[str]]] = ClassB()
v1: Callable[[ClassA[str]], tuple[int, ClassA[str]]] = lambda r: (42, r)

ret = b1.method1(v1)
reveal_type(ret, expected_text="str | None")
