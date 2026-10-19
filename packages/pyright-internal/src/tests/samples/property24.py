# This sample tests the handling of assigning a lambda to a property setter
# typed as a Callable (issue 11833).

from collections.abc import Callable


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


def test_errors(c: C) -> None:
    # This should generate an error because lambda takes too many parameters.
    c.p = lambda a, b, extra: None
