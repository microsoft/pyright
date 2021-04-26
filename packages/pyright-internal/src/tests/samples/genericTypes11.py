# This sample validates generic type matching for protocol
# classes where the protocol is partially specialized with a
# type variable.

# pyright: strict

from typing import Callable, Iterator, TypeVar

_T = TypeVar("_T")


class Foo(Iterator[_T]):
    pass


def foo(func: Callable[..., Iterator[_T]]) -> Callable[..., Foo[_T]]:
    ...


@foo
def f() -> Iterator[str]:
    yield ""


a = f()
b: Foo[str] = a
