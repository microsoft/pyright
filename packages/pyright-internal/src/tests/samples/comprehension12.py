# This sample tests that lambdas create non-async function boundaries
# for eager asynchronous comprehensions.

from collections.abc import AsyncGenerator, AsyncIterable
from typing import Any

class_values: Any


async def async_function(values: Any):
    [value async for value in values]
    {value async for value in values}
    {value: value async for value in values}
    (value async for value in values)

    # These should generate errors because a lambda is not async.
    lambda: [value async for value in values]
    lambda: {value async for value in values}
    lambda: {value: value async for value in values}

    # An async generator expression is allowed because its execution is deferred.
    lambda: (value async for value in values)

    # These async comprehensions execute in the deferred async generator body.
    lambda: ([value async for value in values] for _ in [0])
    lambda: (item for item in [0] if [value async for value in values])

    # This should generate an error because the generator's first iterable is eager.
    lambda: (item for item in [value async for value in values])

    # These should generate errors at the nearest lambda boundary.
    lambda: lambda: [value async for value in values]
    lambda: (lambda default=[value async for value in values]: default)

    # A lambda default is evaluated in its enclosing async function.
    lambda default=[value async for value in values]: default

    def sync_nested():
        # This should generate an error in a nested sync function.
        [value async for value in values]

    class Nested:
        # This should generate an error in a nested class body.
        values = [value async for value in class_values]


def sync_function(values: Any):
    # These should generate errors in a sync function.
    [value async for value in values]
    {value async for value in values}
    {value: value async for value in values}

    # An async generator expression is allowed in a sync function.
    (value async for value in values)


def sync_async_generator_expression(values: AsyncIterable[int]):
    # Creating an async generator is valid in a synchronous function, even in a list.
    [(value async for value in values)]


async def nested_async_comprehensions(values: AsyncIterable[int]) -> None:
    body = lambda: ([value async for value in values] for _ in [0])
    filter_case = lambda: (value for value in [0] if [item async for item in values])
    later_iterable = lambda: (item for _ in [0] for item in [value async for value in values])
    lambda_default = lambda: ((lambda default=[value async for value in values]: default) for _ in [0])
    nested_eager = lambda: ([[value async for value in values] for _ in [0]] for _ in [0])
    nested_generator = lambda: ((value async for value in values) for _ in [0])

    reveal_type(body(), expected_text="AsyncGenerator[list[int], None]")
    reveal_type(filter_case(), expected_text="AsyncGenerator[int, None]")
    reveal_type(later_iterable(), expected_text="AsyncGenerator[int, None]")
    reveal_type(nested_eager(), expected_text="AsyncGenerator[list[list[int]], None]")
    reveal_type(nested_generator(), expected_text="Generator[AsyncGenerator[int, None], None, None]")

    body_result: AsyncGenerator[list[int], None] = body()
    filter_result: AsyncGenerator[int, None] = filter_case()
    later_result: AsyncGenerator[int, None] = later_iterable()
    lambda_default_result: AsyncGenerator[object, None] = lambda_default()

    next(body())  # This should generate an error because an async generator isn't a synchronous iterator.
    async for value in body():
        reveal_type(value, expected_text="list[int]")
