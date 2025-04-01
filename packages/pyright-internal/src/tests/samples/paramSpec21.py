# This sample tests the case where a ParamSpec is used within a source
# and destination callback protocol.

from typing import Callable, Protocol
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    Concatenate,
    ParamSpec,
)

P1 = ParamSpec("P1")
P2 = ParamSpec("P2")
P3 = ParamSpec("P3")
P4 = ParamSpec("P4")


class Context: ...


class Response: ...


class ContextCallback(Protocol[P1]):
    def __call__(
        self, ctx: Context, /, *args: P1.args, **kwargs: P1.kwargs
    ) -> Response: ...


def call_context_callback(
    callback: ContextCallback[P3], /, *args: P3.args, **kwargs: P3.kwargs
) -> Response: ...


class IntContextCallback(Protocol[P2]):
    def __call__(
        self, ctx: Context, value: int, /, *args: P2.args, **kwargs: P2.kwargs
    ) -> Response: ...


def call_int_context_callback(
    callback: IntContextCallback[P4], value: int, /, *args: P4.args, **kwargs: P4.kwargs
) -> Response:
    return call_context_callback(callback, value, *args, **kwargs)


P5 = ParamSpec("P5")
P6 = ParamSpec("P6")
P7 = ParamSpec("P7")

ContextCallable = Callable[Concatenate[Context, P5], Response]
IntContextCallable = Callable[Concatenate[Context, int, P6], Response]


def call_int_context_callable(
    callback: IntContextCallable[P7], value: int, /, *args: P7.args, **kwargs: P7.kwargs
) -> Response:
    return call_context_callback(callback, value, *args, **kwargs)
