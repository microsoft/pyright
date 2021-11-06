# This sample tests the handling of generic type aliases that are
# defined in terms of other generic type aliases in a nested manner.

from typing import Awaitable, Callable, Generic, TypeVar


TSource = TypeVar("TSource")
TError = TypeVar("TError")
TResult = TypeVar("TResult")
TNext = TypeVar("TNext")


class Context(Generic[TResult]):
    Response: TResult


class Result(Generic[TResult, TError]):
    def map(
        self, mapper: Callable[[Context[TResult]], TResult]
    ) -> "Result[TResult, TError]":
        return Result()


HttpFuncResult = Result[Context[TResult], TError]
HttpFuncResultAsync = Awaitable[Result[Context[TResult], TError]]

HttpFunc = Callable[
    [Context[TNext]],
    HttpFuncResultAsync[TResult, TError],
]

HttpHandler = Callable[
    [
        HttpFunc[TNext, TResult, TError],
        Context[TSource],
    ],
    HttpFuncResultAsync[TResult, TError],
]


async def run_async(
    ctx: Context[TSource],
    handler: HttpHandler[str, TResult, TError, TSource],
) -> Result[TResult, TError]:
    result = Result[TResult, TError]()

    def mapper(x: Context[TResult]) -> TResult:
        return x.Response

    return result.map(mapper)
