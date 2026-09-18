# This sample tests that lambdas create non-async function boundaries
# for eager asynchronous comprehensions.

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
