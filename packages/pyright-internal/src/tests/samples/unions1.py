# This sample tests the alternative syntax for unions as
# documented in PEP 604.

from typing import Callable, Generic, Literal, TypeVar


def foo1(a: int):
    if isinstance(a, int | str | bytes):
        return 3


def foo2(a: int | str):
    if isinstance(a, int):
        return 1
    else:
        return 2


B = bytes | None | Callable[[], None]
A = int | str | B


def foo3(a: A) -> B:
    if a == 3 or a is None:
        return b""
    elif not isinstance(a, (int, str, bytes)):
        a()


def foo4(A: "int | str"):
    return 1


T = TypeVar("T")


def foo5(a: str):
    def helper(value: T) -> T | None:
        ...

    class Baz(Generic[T]):
        qux: T | None

    t1: Literal["str | None"] = reveal_type(helper(a))
    t2: Literal["str | None"] = reveal_type(Baz[str].qux)
