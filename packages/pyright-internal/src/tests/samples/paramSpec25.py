# This sample tests the case where a generic type uses a ParamSpec
# as a type parameter and it is specialized using an empty signature.

from typing import Any, Callable, Concatenate, Generic, Literal, ParamSpec

P = ParamSpec("P")


class Context:
    ...


CommandHandler = Callable[Concatenate[Context, P], Any]


class Command(Generic[P]):
    def __init__(
        self,
        handler: CommandHandler[P],
    ) -> None:
        ...


def handler_no_args(ctx: Context) -> None:
    ...


def handler_one_arg(ctx: Context, a: int) -> None:
    ...


cmd_no_args = Command(handler_no_args)
t0: Literal["Command[()]"] = reveal_type(cmd_no_args)

cmd_one_arg = Command(handler_one_arg)
t2: Literal["Command[(a: int)]"] = reveal_type(cmd_one_arg)
