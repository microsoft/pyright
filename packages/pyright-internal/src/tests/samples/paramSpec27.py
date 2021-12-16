# This sample tests the case where an ellipsis is used to specialize
# a generic class parameterized by a ParamSpec.

from typing import Callable, Protocol
from typing_extensions import Concatenate, ParamSpec, TypeAlias

P = ParamSpec("P")


def func1(a: int, b: str) -> None:
    ...


def func2(a: str, b: str) -> None:
    ...


class Handler(Protocol[P]):
    def __call__(self, /, *args: P.args, **kwargs: P.kwargs) -> None:
        ...


class ConcatHandler(Protocol[P]):
    def __call__(self, a: int, /, *args: P.args, **kwargs: P.kwargs) -> None:
        ...


ConcatCallableHandler: TypeAlias = Callable[Concatenate[int, P], None]


handler_callable1: Callable[..., None] = func1
concat_handler_callable1: ConcatCallableHandler[...] = func1

# This should generate an error because the first param of func2 is not int.
concat_handler_callable2: ConcatCallableHandler[...] = func2

handler1: Handler[...] = func1
concat_handler1: ConcatHandler[...] = func1

# This should generate an error because the first param of func2 is not int.
concat_handler2: ConcatHandler[...] = func2
