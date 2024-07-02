# This sample tests a complicated use case involving multiple
# callback protocols.

from typing import Protocol, TypeVar, Any


_T1 = TypeVar("_T1", contravariant=True)
_T2 = TypeVar("_T2", covariant=True)
_T3 = TypeVar("_T3", covariant=True)


class Callable1(Protocol[_T1]):
    def __call__(self, __x: _T1) -> Any: ...


_T4 = TypeVar("_T4", bound=Callable1[Any])


class Decorator1(Protocol[_T2]):
    def __call__(self, __x: Callable1[_T2]) -> Any: ...


def decorator1(__x: Decorator1[_T3]) -> Decorator1[_T3]: ...


def func1(__x: _T4) -> _T4: ...


decorator1(func1)
