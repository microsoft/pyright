# This sample tests a complicated use case involving multiple
# callback protocols.

from typing import Callable, Protocol, TypeVar, Any


_T1 = TypeVar("_T1", contravariant=True)
_T2 = TypeVar("_T2", covariant=True)
_T3 = TypeVar("_T3", covariant=True)
Tv_my_callable = TypeVar("Tv_my_callable", bound="MyCallable[Any]")


class MyCallable(Protocol[_T1]):
    def __call__(self, __x: _T1) -> Any:
        ...


class MyDecorator(Protocol[_T2]):
    def __call__(self, __x: MyCallable[_T2]) -> Any:
        ...


def decorates_my_callable(__x: MyDecorator[_T3]) -> MyDecorator[_T3]:
    ...


def my_decorator_inner(__x: Tv_my_callable) -> Tv_my_callable:
    ...


decorates_my_callable(my_decorator_inner)

