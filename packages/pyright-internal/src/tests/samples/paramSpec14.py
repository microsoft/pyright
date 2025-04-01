# This sample tests the handling of ParamSpec when used with
# static methods and class methods.

from typing import Any, Callable, Generic, ParamSpec, Self, TypeVar, overload

P = ParamSpec("P")
T = TypeVar("T")


def deco(func: Callable[P, float]) -> Callable[P, int]:
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> int:
        return round(func(*args, **kwargs))

    return wrapper


class ClassA:
    @deco
    @classmethod
    def identity_cls(cls, val: float) -> float:
        return val

    @deco
    @staticmethod
    def identity_static(val: float) -> float:
        return val


reveal_type(ClassA.identity_cls(1.2), expected_text="int")
reveal_type(ClassA.identity_static(1.2), expected_text="int")


class ClassB(Generic[P, T]):
    @overload
    @classmethod
    def method1(
        cls, run: Callable[P, T], /, *args: P.args, **kwargs: P.kwargs
    ) -> Self: ...

    @overload
    @classmethod
    def method1(cls) -> "ClassB[[], None]": ...

    @classmethod
    def method1(cls, *args: Any, **kwargs: Any) -> Any: ...


def func1() -> None:
    pass


m1 = ClassB.method1
m1(func1)
