# Async comprehensions cannot suspend evaluation of a Python 3.14 annotation.
from typing import Annotated


async def metadata() -> int:
    return 1


async def items() -> tuple[int, ...]:
    return (1, 2)


async def sequence():
    yield 1


async def outer():
    # scope error: async for
    async_for: Annotated[int, [item async for item in sequence()]] = 0
    # scope error: await
    body: Annotated[int, [await metadata() for item in (1,)]] = 0
    # scope error: await
    condition: Annotated[int, [item for item in (1,) if await metadata()]] = 0
    # scope error: await
    later_iterable: Annotated[int, [item for item in (1,) for other in await items()]] = 0
    # scope error: await
    set_body: Annotated[int, {await metadata() for item in (1,)}] = 0
    # scope error: await
    dict_value: Annotated[int, {item: await metadata() for item in (1,)}] = 0
    # scope error: await
    nested: Annotated[int, [[await metadata() for item in (1,)] for outer in (1,)]] = 0
    # The first iterable of a generator still executes in the annotation scope.
    # scope error: await
    eager_iterable: Annotated[int, (item for item in [await metadata() for other in (1,)])] = 0

    # Generator bodies and nested lambda bodies retain their own scopes.
    generator_body: Annotated[int, (await metadata() for item in (1,))] = 0
    generator_condition: Annotated[int, (item for item in (1,) if await metadata())] = 0
    generator_iterable: Annotated[int, (item for item in (1,) for other in await items())] = 0
    generator_async: Annotated[int, (item async for item in sequence())] = 0
    generator_nested: Annotated[int, ([await metadata() for item in (1,)] for outer in (1,))] = 0
    lambda_body: Annotated[int, lambda: (meta := 1)] = 0
    lambda_yield: Annotated[int, lambda: (yield 1)] = 0

    # Ordinary expressions still have their enclosing async execution scope.
    ordinary = [await metadata() async for item in sequence()]
    reveal_type(ordinary, expected_text="list[int]")


async def unreachable():
    return
    # scope error: async for
    async_for: Annotated[int, [item async for item in sequence()]] = 0
    # scope error: await
    body: Annotated[int, [await metadata() for item in (1,)]] = 0


async def false_branch():
    if False:
        # scope error: await
        condition: Annotated[int, [item for item in (1,) if await metadata()]] = 0
