# This sample tests the case where a protocol uses a covariant
# type parameter but a corresponding implementation uses an
# invariant type parameter. Literal types need to be handled
# carefully in this case.

from typing import Any, Awaitable, Generator, Literal, TypeVar

_T = TypeVar("_T")


class Future(Awaitable[_T]):
    def __await__(self) -> Generator[Any, None, _T]: ...


def func1(future: Future[_T]) -> Future[_T]: ...


def func2(cb: Awaitable[_T]) -> Future[_T]: ...


def func3() -> Awaitable[Literal[True]]: ...


v1 = func1(func2(func3()))
reveal_type(v1, expected_text="Future[Literal[True]]")
