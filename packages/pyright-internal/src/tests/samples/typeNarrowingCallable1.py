# This sample tests the type engine's narrowing logic for
# callable expressions.

from typing import Callable, Literal, Optional, Type, TypeVar, Union


class CallableObj:
    def __call__(self, val: int):
        return 3


def f(a: int) -> Union[Callable[[int], int], Type[int], CallableObj, int]:
    if a == 0:

        def h(b: int):
            return 3

        return h
    elif a < 40:
        return 2
    else:
        return int


q = f(45)
if callable(q):
    w = q(3)

if not callable(q):
    a = q + 3


def g(a: Optional[Callable[[int], int]]):
    if callable(a):
        a(3)


T = TypeVar("T")


def test1(arg: Union[T, Callable[[], T]]) -> T:
    if callable(arg):
        return arg()
    return arg


class Foo:
    def bar(self) -> None:
        pass


def test2(o: Foo) -> None:
    if callable(o):
        t_1: Literal["<callable subtype of Foo>"] = reveal_type(o)

        # This should generate an error
        o.foo()
        o.bar()
        r1 = o(1, 2, 3)
        t_r1: Literal["Unknown"] = reveal_type(r1)
    else:
        o.bar()

        # This should generate an error
        o(1, 2, 3)


T = TypeVar("T", int, str, Callable[[], int], Callable[[], str])


def test3(v: T) -> Union[T, int, str]:
    if callable(v):
        t1: Literal["() -> int | () -> str"] = reveal_type(v)
        t2: Literal["int* | str*"] = reveal_type(v())
        return v()
    else:
        t3: Literal["int* | str*"] = reveal_type(v)
        return v
