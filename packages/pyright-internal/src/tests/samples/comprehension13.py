from collections.abc import AsyncIterable


class Base:
    def __init_subclass__(cls, **kwargs): ...


async def func(values: AsyncIterable[int]) -> None:
    # This should generate an error because a generic class header is not async.
    class Generic[T](Base, key=[value async for value in values]): ...

    # This is allowed because a non-generic class header uses the enclosing scope.
    class NonGeneric(Base, key=[value async for value in values]): ...
