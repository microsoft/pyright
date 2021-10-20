# This sample tests the use of ParamSpec along with Concatenate in
# a return type.

from typing import Callable, Literal, Protocol, TypeVar, Concatenate, ParamSpec
from threading import RLock
import functools


class HasLock(Protocol):
    _lock: RLock


S = TypeVar("S", bound=HasLock)
P = ParamSpec("P")
R = TypeVar("R")


def with_lock(func: Callable[Concatenate[S, P], R]) -> Callable[Concatenate[S, P], R]:
    @functools.wraps(func)
    def wrapper(self: S, *args: P.args, **kwargs: P.kwargs) -> R:
        with self._lock:
            return func(self, *args, **kwargs)

    return wrapper


class MyClass:
    def __init__(self):
        self._lock = RLock()

    @with_lock
    def test_1(self, param1: int) -> str:
        ...

    @with_lock
    def test_2(self) -> str:
        ...


@with_lock
def test_3(cls: MyClass, param1: int) -> str:
    ...


testClass = MyClass()

res1 = testClass.test_1(42)
t_res1: Literal["str"] = reveal_type(res1)

res2 = testClass.test_2()
t_res2: Literal["str"] = reveal_type(res2)

res3 = test_3(testClass, 42)
t_res3: Literal["str"] = reveal_type(res3)

res4: Callable[[MyClass, int], str] = with_lock(test_3)
t_res4: Literal["(MyClass, param1: int) -> str"] = reveal_type(res4)
