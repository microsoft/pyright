# This sample tests the type engine's narrowing logic for
# callable expressions.

from typing import Callable, Optional, Type, TypeVar, Union


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


_T1 = TypeVar("_T1")


def test1(arg: Union[_T1, Callable[[], _T1]]) -> _T1:
    if callable(arg):
        return arg()
    return arg


class Foo:
    def bar(self) -> None:
        pass


def test2(o: Foo) -> None:
    if callable(o):
        reveal_type(o, expected_text="<callable subtype of Foo>")

        # This should generate an error
        o.foo()
        o.bar()
        r1 = o(1, 2, 3)
        reveal_type(r1, expected_text="Unknown")
    else:
        o.bar()

        # This should generate an error
        o(1, 2, 3)


_T2 = TypeVar("_T2", int, str, Callable[[], int], Callable[[], str])


def test3(v: _T2) -> Union[_T2, int, str]:
    if callable(v):
        reveal_type(v, expected_text="(() -> int) | (() -> str)")
        reveal_type(v(), expected_text="int* | str*")
        return v()
    else:
        reveal_type(v, expected_text="int* | str*")
        return v
