# This sample tests the case where a ParamSpec is used within a generic
# type alias with a Callable.

from typing import Any, Callable, Generic, Protocol
from typing_extensions import Concatenate, ParamSpec

P = ParamSpec("P")

# Example 1: Callable generic type alias

CommandHandler1 = Callable[Concatenate[int, P], dict[str, Any]]


class Command1(Generic[P]):
    def __init__(self, handler: CommandHandler1[P]) -> None:
        ...


class Application1:
    def func(self, handler: CommandHandler1[P]) -> Command1[P]:
        return Command1(handler)


# Example 2: Callback Protocol


class CommandHandler2(Protocol[P]):
    def __call__(self, *args: P.args, **kwargs: P.kwargs) -> dict[str, Any]:
        ...


class Command2(Generic[P]):
    def __init__(self, handler: CommandHandler2[P]) -> None:
        ...


class Application2:
    def func(self, handler: CommandHandler2[P]) -> Command2[P]:
        return Command2(handler)
