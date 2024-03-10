# This sample tests the case where a specialized generic class that uses
# a ParamSpec and a callback protocol is assigned to a Callable that
# uses a ParamSpec.

from typing import Callable, Generic, TypeVar
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    Concatenate,
    ParamSpec,
)

P = ParamSpec("P")
R = TypeVar("R")


class MyPartial(Generic[P, R]):
    def __init__(self, first: int, func: Callable[Concatenate[int, P], R]) -> None:
        self.first = first
        self.func = func

    def __call__(self, *args: P.args, **kwargs: P.kwargs) -> R: ...


class MyPartialCreator(Generic[P, R]):
    def __init__(self, func: Callable[Concatenate[int, P], R]):
        self.func = func

    def create_partial(self, first: int) -> Callable[P, R]:
        return MyPartial[P, R](first=first, func=self.func)
