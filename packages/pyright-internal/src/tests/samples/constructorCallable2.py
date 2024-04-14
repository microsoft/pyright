# This sample tests the case where a constructor is converted to
# a callable.


from typing import Any, Callable, NoReturn, ParamSpec, Self, TypeVar, reveal_type

P = ParamSpec("P")
R = TypeVar("R")
T = TypeVar("T")


def accepts_callable(cb: Callable[P, R]) -> Callable[P, R]:
    return cb


class Class1:
    def __init__(self, x: int) -> None:
        pass


r1 = accepts_callable(Class1)
reveal_type(r1, expected_text="(x: int) -> Class1")
reveal_type(r1(1), expected_text="Class1")


class Class2:
    pass


r2 = accepts_callable(Class2)
reveal_type(r2, expected_text="() -> Class2")
reveal_type(r2(), expected_text="Class2")


class Class3:
    def __new__(cls, *args, **kwargs) -> Self: ...
    def __init__(self, x: int) -> None: ...


r3 = accepts_callable(Class3)
reveal_type(r3, expected_text="(x: int) -> Class3")
reveal_type(r3(3), expected_text="Class3")


class Class4:
    """__new__ but no __init__"""

    def __new__(cls, x: int) -> int: ...


r4 = accepts_callable(Class4)
reveal_type(r4, expected_text="(x: int) -> int")
reveal_type(r4(1), expected_text="int")


class Meta1(type):
    def __call__(cls, *args: Any, **kwargs: Any) -> NoReturn:
        raise NotImplementedError("Class not constructable")


class Class5(metaclass=Meta1):
    """Custom metaclass that overrides type.__call__"""

    def __new__(cls, *args: Any, **kwargs: Any) -> Self:
        """This __new__ is ignored for purposes of conversion"""
        return super().__new__(cls)


r5 = accepts_callable(Class5)
reveal_type(r5, expected_text="(*args: Any, **kwargs: Any) -> NoReturn")
