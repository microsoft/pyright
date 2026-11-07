# This sample tests nested generic callbacks whose argument packs must be
# solved before comparing the callbacks that use them.

from asyncio import AbstractEventLoop
from collections.abc import Callable
from typing import TypeVar, TypeVarTuple

Ts = TypeVarTuple("Ts")
R = TypeVar("R")


def soon(callback: Callable[[*Ts], R], *args: *Ts) -> R:
    raise NotImplementedError


def later(delay: float, callback: Callable[[*Ts], object], *args: *Ts) -> str:
    raise NotImplementedError


def executor(pool: object, callback: Callable[[*Ts], R], *args: *Ts) -> R:
    raise NotImplementedError


def work() -> int:
    return 1


def increment(value: int) -> int:
    return value + 1


reveal_type(soon(later, 5, executor, None, work), expected_text="str")
reveal_type(soon(later, 5, executor, None, increment, 1), expected_text="str")
reveal_type(soon(executor, None, increment, 1), expected_text="int")

# This should generate an error because the delay must be a float.
soon(later, "invalid", executor, None, work)

# This should generate an error because work accepts no arguments.
soon(later, 5, executor, None, work, 1)

# This should generate an error because increment requires an int.
soon(later, 5, executor, None, increment, "invalid")


async def schedule(loop: AbstractEventLoop) -> None:
    handle = loop.call_soon_threadsafe(
        loop.call_later, 5, loop.run_in_executor, None, work
    )
    reveal_type(handle, expected_text="Handle")
