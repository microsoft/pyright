# This sample tests the case where a specialized generic class that uses
# a ParamSpec and a callback protocol is assigned to a Callable that
# uses a ParamSpec.

from typing import Callable, Generic, TypeVar
from typing_extensions import Concatenate, ParamSpec

P = ParamSpec("P")
OUT = TypeVar("OUT")


class MyPartial(Generic[P, OUT]):
    def __init__(self, first: int, func: Callable[Concatenate[int, P], OUT]) -> None:
        self.first = first
        self.func = func

    def __call__(self, *args: P.args, **kwargs: P.kwargs) -> OUT:
        ...


class MyPartialCreator(Generic[P, OUT]):
    def __init__(self, func: Callable[Concatenate[int, P], OUT]):
        self.func = func

    def create_partial(self, first: int) -> Callable[P, OUT]:
        return MyPartial[P, OUT](first=first, func=self.func)
