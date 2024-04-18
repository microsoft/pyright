# This sample tests a case that involves an interaction between a class
# that uses auto-variance and a decorator that uses a generic type alias.

from typing import Any, Concatenate, Generic, ParamSpec, TypeAlias, Callable
from typing_extensions import TypeVar  # pyright: ignore[reportMissingModuleSource]

T = TypeVar("T", infer_variance=True)
P = ParamSpec("P")
R = TypeVar("R")
S = TypeVar("S", bound="A[Any]")

TA1: TypeAlias = Callable[Concatenate[S, P], R]


def deco(func: TA1[S, P, R], /) -> TA1[S, P, R]: ...


class A(Generic[T]):
    @deco
    def select_all(self, *args: object) -> list[Any]: ...
