# This sample tests that generic type variables
# with a bound type properly generate errors. It tests
# both class-defined and function-defined type variables.

from typing import Generic, TypeVar, Union


class Foo:
    var1: int

    def __call__(self, val: int):
        pass

    def do_stuff(self) -> int:
        return 0


class Bar:
    var1: int
    var2: int

    def __call__(self, val: int):
        pass

    def do_stuff(self) -> float:
        return 0

    def do_other_stuff(self) -> float:
        return 0


_T1 = TypeVar("_T1", bound=Foo)
_T2 = TypeVar("_T2", bound=Union[Foo, Bar])


class ClassA(Generic[_T1]):
    async def func1(self, a: _T1) -> _T1:
        _ = a.var1

        # This should generate an error.
        _ = a.var2

        _ = a(3)

        # This should generate an error.
        _ = a(3.3)

        # This should generate an error.
        _ = a[0]

        # This should generate an error.
        _ = a + 1

        # This should generate an error.
        _ = -a

        # This should generate an error.
        a += 3

        # This should generate an error.
        _ = await a

        # This should generate an error.
        for _ in a:
            pass

        a.do_stuff()

        # This should generate an error.
        a.do_other_stuff()

        _ = a.__class__
        _ = a.__doc__

        return a

    async def func2(self, a: _T2) -> _T2:
        _ = a.var1

        # This should generate an error.
        _ = a.var2

        _ = a(3)

        # This should generate an error.
        _ = a(3.3)

        # This should generate two errors.
        _ = a[0]

        # This should generate an error.
        _ = a + 1

        # This should generate an error.
        _ = -a

        # This should generate an error.
        a += 3

        # This should generate an error.
        _ = await a

        # This should generate an error.
        for _ in a:
            pass

        a.do_stuff()

        # This should generate an error.
        a.do_other_stuff()

        _ = a.__class__
        _ = a.__doc__

        return a
