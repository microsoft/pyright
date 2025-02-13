# This sample tests the case where a __new__ method provides
# a type that differs from the class that contains it.


from typing import Any, Callable, ParamSpec, Self, TypeVar


class ClassA:
    def __new__(cls) -> str:
        return "Hello World"


v1 = ClassA()
reveal_type(v1, expected_text="str")


_P = ParamSpec("_P")
_R = TypeVar("_R")


def func1(a: int) -> int:
    return a + 1


class ClassB:
    def __new__(cls, func: Callable[_P, _R]) -> Callable[_P, _R]:
        return func


v2 = ClassB(func1)
reveal_type(v2, expected_text="(a: int) -> int")


class ClassC:
    def __new__(cls) -> Any:
        return 1

    def __init__(self, a: int) -> None: ...


ClassC()


class ClassD:
    def __new__(cls) -> Self | Any:
        return 1

    def __init__(self, a: int) -> None: ...


ClassD()
