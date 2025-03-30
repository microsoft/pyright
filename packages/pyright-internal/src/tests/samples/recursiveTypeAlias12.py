# This sample tests the case where a recursive type alias is evaluated
# for type compatibility with a recursive protocol. We want to make sure
# this doesn't lead to extremely long evaluation times or stack overflows.

from collections.abc import Callable
from types import FrameType
from typing import Any, Protocol, Self, TypeAlias


class TraceFunctionProto(Protocol):
    def __call__(self, frame: FrameType, event: str, arg: Any) -> Self | None: ...


TraceFunction: TypeAlias = Callable[[FrameType, str, Any], "TraceFunction | None"]


def settrace(tf: TraceFunction | None) -> None: ...


def func1(frame: FrameType, event: str, arg: Any) -> TraceFunction: ...


def func2(tf: TraceFunctionProto | None):
    settrace(tf)
    settrace(func1)
