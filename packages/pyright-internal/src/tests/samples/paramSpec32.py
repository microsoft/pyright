# This sample tests the case where a ParamSpec and its P.args and P.kwargs
# parameters are used within a constructor.

from typing import Callable, Generic, TypeVar
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    Concatenate,
    ParamSpec,
)

P = ParamSpec("P")
T1 = TypeVar("T1")
T2 = TypeVar("T2")


def add_k(x: int, k: int) -> int:
    return x + k


class Class1(Generic[P, T2]):
    def __init__(self, fn: Callable[P, T2], *args: P.args, **kwargs: P.kwargs) -> None:
        self.fn = fn
        self.args = args
        self.kwargs = kwargs

    def __call__(self) -> T2:
        return self.fn(*self.args, **self.kwargs)


# This should generate an error because arguments x and k are missing.
Class1(add_k)

# This should generate an error because arguments x has the wrong type.
Class1(add_k, "3", 2)

Class1(add_k, 3, 2)
Class1(add_k, x=3, k=2)


class Class2(Generic[P, T1, T2]):
    def __init__(
        self, fn: Callable[Concatenate[T1, P], T2], *args: P.args, **kwargs: P.kwargs
    ) -> None:
        self.fn = fn
        self.args = args
        self.kwargs = kwargs

    def __call__(self, value: T1) -> T2:
        return self.fn(value, *self.args, **self.kwargs)


# This should generate an error because argument x is missing.
Class2(add_k)

# This should generate an error because arguments x has the wrong type.
Class2(add_k, "3")

Class2(add_k, 2)

Class2(add_k, k=2)
