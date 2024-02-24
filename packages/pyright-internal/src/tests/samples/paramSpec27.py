# This sample tests the case where an ellipsis is used to specialize
# a generic class parameterized by a ParamSpec.

from typing import Callable, Generic, Protocol, assert_type
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    Concatenate,
    ParamSpec,
    TypeAlias,
)

P = ParamSpec("P")


def func1(a: int, b: str) -> None: ...


def func2(a: str, b: str) -> None: ...


class Handler(Protocol[P]):
    def __call__(self, /, *args: P.args, **kwargs: P.kwargs) -> None: ...


class ConcatHandler(Protocol[P]):
    def __call__(self, a: int, /, *args: P.args, **kwargs: P.kwargs) -> None: ...


ConcatCallableHandler: TypeAlias = Callable[Concatenate[int, P], None]


handler_callable1: Callable[..., None] = func1
concat_handler_callable1: ConcatCallableHandler[...] = func1

# This should generate an error because the first param of func2 is not int.
concat_handler_callable2: ConcatCallableHandler[...] = func2

handler1: Handler[...] = func1
concat_handler1: ConcatHandler[...] = func1

# This should generate an error because the first param of func2 is not int.
concat_handler2: ConcatHandler[...] = func2


def func0(x: ConcatCallableHandler[str, str]):
    assert_type(x, Callable[[int, str, str], None])


class Command(Generic[P]):
    def __init__(self, handler: Handler[P]) -> None:
        self.handler: Handler[P] = handler


commands: list[Command[...]] = []


def do_something(int_handler: Handler[int], var_args_handler: Handler[P], /) -> None:
    int_command = Command(int_handler)
    commands.append(int_command)

    var_args_command = Command(var_args_handler)
    commands.append(var_args_command)
