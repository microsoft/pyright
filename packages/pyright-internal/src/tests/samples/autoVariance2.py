# This sample tests an auto-invariance case that involves recursive types.

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Concatenate, Protocol


@dataclass
class Node[T]:
    left: Node[T]
    right: Node[T]
    value: T


class MyPartial[**P, R]:
    def __init__(self, first: int, func: Callable[Concatenate[int, P], R]) -> None:
        self.first = first
        self.func = func

    def __call__(self, *args: P.args, **kwargs: P.kwargs) -> R: ...


class CallbackKeyed[*Ts](Protocol):
    def __call__(self, *args: *Ts, keyed: bool) -> tuple[*Ts]: ...


def invoke_keyed[*Ts](fn: CallbackKeyed[*Ts], *args: *Ts) -> tuple[*Ts]:
    return fn(*args, keyed=True)
