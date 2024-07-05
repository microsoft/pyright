# This sample tests that generic type variables
# with constrained types properly generate errors. It tests
# both class-defined and function-defined type variables.

from typing import Generic, TypeVar


class Foo:
    var1: int

    def __call__(self, val: int):
        pass

    def do_stuff(self) -> int:
        return 0

    def __add__(self, val: "Foo") -> "Foo":
        return val


class Bar:
    var1: int
    var2: int

    def __call__(self, val: int):
        pass

    def do_stuff(self) -> float:
        return 0

    def do_other_stuff(self) -> float:
        return 0

    def __add__(self, val: "Bar") -> "Bar":
        return val


_T1 = TypeVar("_T1", Foo, Bar)
_T2 = TypeVar("_T2", Foo, Bar, str)


class ClassA(Generic[_T1, _T2]):
    async def func1(self, a: _T1) -> _T1:
        _ = a.var1

        # This should generate an error.
        _ = a.var2

        # This should generate an error.
        _ = a(3.3)

        # This should generate two errors.
        _ = a[0]

        # This should generate an error.
        _ = a + 1

        _ = a + a

        a += a

        # This should generate an error.
        _ = -a

        # This should generate an error.
        a += 3

        # This should generate an error.
        _ = await a

        # This should generate two errors.
        for _ in a:
            pass

        a.do_stuff()

        # This should generate an error.
        a.do_other_stuff()

        _ = a.__class__
        _ = a.__doc__

        return a

    async def func2(self, a: _T2, b: _T1) -> _T1:
        # This should generate two errors.
        _ = a.var2

        # This should generate an error.
        _ = a(3.3)

        # This should generate two errors.
        _ = a[0]

        # This should generate an error.
        _ = a + 1

        _ = a + a

        a += a

        # This should generate an error.
        _ = a + b

        # This should generate an error.
        _ = -a

        # This should generate an error.
        a += 3

        # This should generate an error.
        _ = await a

        # This should generate an error.
        for _ in a:
            pass

        # This should generate an error.
        a.do_other_stuff()

        _ = a.__class__
        _ = a.__doc__

        return b


_T3 = TypeVar("_T3", float, int, str)
_T4 = TypeVar("_T4", float, int)


def custom_add(a: _T3, b: _T4) -> float:
    if isinstance(a, str):
        return 0
    c = a + b
    reveal_type(c, expected_text="float* | int*")
    return c


class Thing1:
    def __add__(self, value: float) -> "Thing1": ...

    def __radd__(self, value: float) -> "Thing1": ...


class Thing2:
    def __add__(self, value: float) -> "Thing2": ...

    def __radd__(self, value: float) -> "Thing2": ...


TThing = TypeVar("TThing", Thing1, Thing2)


def func1(x: TThing) -> TThing:
    if isinstance(x, Thing1):
        return 2 + x
    else:
        assert isinstance(x, Thing2)
        return 3 + x


def func2(x: TThing) -> TThing:
    if isinstance(x, Thing1):
        return x + 2
    else:
        assert isinstance(x, Thing2)
        return x + 3
