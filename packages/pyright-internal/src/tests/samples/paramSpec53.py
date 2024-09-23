# This sample tests the case where a ParamSpec captures a named parameter
# that is combined with a positional-only parameter of the same name.

from typing import TypeVar, Callable, ParamSpec

P = ParamSpec("P")
T = TypeVar("T")


class Mixin:
    @classmethod
    def factory(
        cls: Callable[P, T], data: str, /, *args: P.args, **kwargs: P.kwargs
    ) -> T: ...


class Next(Mixin):
    def __init__(self, data: int) -> None:
        pass


Next.factory("", data=2)
