# This sample tests the assignment of generic callables
# to concrete callable types.

from asyncio.futures import Future
from asyncio.tasks import ensure_future
from typing import Any, Awaitable, Callable, Iterable, Sequence, TypeVar


_T1 = TypeVar("_T1")


def func1(__iterable: Iterable[_T1]) -> _T1: ...


a: Callable[[Sequence[float]], float] = func1
b: Callable[[Sequence[Any]], Any] = func1


def func2(__iterable: Sequence[_T1]) -> _T1: ...


# This should generate an error because an Iterable parameter
# is not assignable to a Sequence parameter.
c: Callable[[Iterable[float]], float] = func2


_T2 = TypeVar("_T2", bound=float)


def func3(__iterable: Iterable[_T2]) -> _T2: ...


d: Callable[[Sequence[int]], int] = func3

# This should generate an error because Sequence[str]
# is not compatible with the bound TypeVar _T2.
e: Callable[[Sequence[str]], Any] = func3


_T3 = TypeVar("_T3")

TA1 = Callable[[_T3], None]
TA2 = Callable[[TA1[_T3]], None]


def func4(cb: TA2[_T3]) -> Awaitable[_T3]:
    future: Future[_T3] = Future()
    return ensure_future(future)


def func5(done: TA1[int]) -> None:
    pass


reveal_type(func4(func5), expected_text="Awaitable[int]")
