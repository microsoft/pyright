# This sample tests various places where await is invalid.

from typing import Any


def func1() -> Any: ...


def func2():
    # These are OK because generators can be called
    # outside of the context of the current function.
    (v async for v in func1())
    (await v for v in func1())

    # This should generate an error because async
    # cannot be used outside of an async function.
    [x async for x in func1()]

    # This should generate an error because async
    # cannot be used outside of an async function.
    {x async for x in func1()}

    # This should generate an error because async
    # cannot be used outside of an async function.
    {k: v async for k, v in func1()}

    # This should generate an error because await
    # cannot be used outside of an async function.
    (x for x in await func1())

    # This should generate an error because await
    # cannot be used outside of an async function.
    [await x for x in func1()]

    # This should generate an error because await
    # cannot be used outside of an async function.
    {await k: v for k, v in func1()}
