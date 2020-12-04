# This sample tests the assignment of generic callables
# to concrete callable types.

from asyncio.futures import Future
from asyncio.tasks import ensure_future
from typing import Any, Awaitable, Callable, Iterable, Literal, Sequence, TypeVar


_T1 = TypeVar("_T1")


def my_min(__iterable: Iterable[_T1]) -> _T1:
    ...


a: Callable[[Sequence[float]], float] = my_min
b: Callable[[Sequence[Any]], Any] = my_min


def my_min2(__iterable: Sequence[_T1]) -> _T1:
    ...


# This should generate an error because an Iterable parameter
# is not assignable to a Sequence parameter.
c: Callable[[Iterable[float]], float] = my_min2


_T2 = TypeVar("_T2", bound=float)


def my_max(__iterable: Iterable[_T2]) -> _T2:
    ...


d: Callable[[Sequence[int]], int] = my_max

# This should generate an error because Sequence[str]
# is not compatible with the bound TypeVar _T2.
e: Callable[[Sequence[str]], Any] = my_max


_T3 = TypeVar("_T3")

Continuation = Callable[[_T3], None]
Callback = Callable[[Continuation[_T3]], None]


def from_continuation(callback: Callback[_T3]) -> Awaitable[_T3]:
    future: Future[_T3] = Future()
    return ensure_future(future)


def callback(done: Continuation[int]) -> None:
    pass


t1: Literal["Awaitable[int]"] = reveal_type(from_continuation(callback))
