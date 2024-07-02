# This sample validates constraint solving for protocol
# classes where the protocol is partially specialized with a
# type variable.

# pyright: strict

from typing import Callable, Iterator, Protocol, TypeVar

_T = TypeVar("_T", covariant=True)


class ProtoA(Iterator[_T], Protocol):
    pass


def decorator1(func: Callable[..., Iterator[_T]]) -> Callable[..., ProtoA[_T]]: ...


@decorator1
def func1() -> Iterator[str]:
    yield ""


a = func1()
b: ProtoA[str] = a
