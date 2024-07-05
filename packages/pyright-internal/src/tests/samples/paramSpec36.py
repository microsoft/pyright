# This sample tests the case where a callback protocol uses a method-scoped
# param spec.

import contextlib
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Callable, Iterator, ParamSpec, Protocol, TypeVar

P = ParamSpec("P")
R = TypeVar("R")


class TakesFunctionWithArguments(Protocol):
    def __call__(
        self, func: Callable[P, R], *args: P.args, **kwargs: P.kwargs
    ) -> Future[R]: ...


@contextlib.contextmanager
def submit_wrapper() -> Iterator[TakesFunctionWithArguments]:
    with ThreadPoolExecutor() as pool:

        def my_submit(
            func: Callable[P, R], *args: P.args, **kwargs: P.kwargs
        ) -> Future[R]:
            return pool.submit(func, *args, **kwargs)

        yield my_submit


def foo(a: int, b: int, c: int) -> int:
    return a + b + c


with submit_wrapper() as submit:
    submit(foo, a=1, b=2, c=3)
    submit(foo, 1, 2, 3)

    # This should generate two errors.
    submit(foo, a=1, b=2, d=3)

    # This should generate an error.
    submit(foo, 1, 2)
