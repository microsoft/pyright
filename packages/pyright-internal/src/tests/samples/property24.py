# This sample tests the handling of assigning a lambda to a property setter
# typed as a Callable (issue 11833).

from collections.abc import Callable
from typing import Self


class C:
    @property
    def p(self) -> Callable[[int, str], object]:
        ...

    @p.setter
    def p(self, value: Callable[[int, str], object]) -> None:
        ...

    r: Callable[[int, str], object]


def f(c: C) -> None:
    c.p = lambda a, b: None
    c.r = lambda a, b: None

    def handler(a: int, b: str) -> None:
        ...

    c.p = handler


class GenericCallback[T]:
    @property
    def cb(self) -> Callable[[T], None]:
        ...

    @cb.setter
    def cb(self, value: Callable[[T], None]) -> None:
        ...


def test_generic(g: GenericCallback[int]) -> None:
    g.cb = lambda x: None



class SelfCallbackBase:
    @property
    def callback(self) -> Callable[[Self], int]:
        ...

    @callback.setter
    def callback(self, value: Callable[[Self], int]) -> None:
        ...


class SelfCallbackChild(SelfCallbackBase):
    def child_only(self) -> int:
        return 42


def test_self(obj: SelfCallbackChild) -> None:
    # Self in the setter's value type should be solved to the type of
    # the object being assigned to, not the class that declares it.
    obj.callback = lambda other: other.child_only()

def test_errors(c: C) -> None:
    # This should generate an error because lambda takes too many parameters.
    c.p = lambda a, b, extra: None
