# This sample tests the inferred type of async and sync generators.


async def foo() -> int:
    ...


async def main() -> None:
    v1 = (x for x in [2, 3] if x > 3)
    reveal_type(v1, expected_text="Generator[int, None, None]")

    v2 = (x for x in [2, 3] if await foo())
    reveal_type(v2, expected_text="AsyncGenerator[int, None]")

    v3 = (x for x in [2, 3])
    reveal_type(v3, expected_text="Generator[int, None, None]")

    v4 = (await foo() for _ in [2, 3])
    reveal_type(v4, expected_text="AsyncGenerator[int, None]")
