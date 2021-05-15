# This sample tests that generic type variables
# with no bound type properly generate errors. It tests
# both class-defined and function-defined type variables.

from typing import Generic, TypeVar


_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2")


class ClassA(Generic[_T1, _T2]):
    async def func1(self, a: _T1):
        # This should generate an error.
        _ = a.temp

        # This should generate an error.
        _ = a(3)

        # This should generate an error.
        _ = a[0]

        # This should generate an error.
        _ = a.temp

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

        _ = a.__class__
        _ = a.__doc__

    async def func2(self, a: _T2):
        # This should generate an error.
        _ = a.temp

        # This should generate an error.
        _ = a(3)

        # This should generate an error.
        _ = a[0]

        # This should generate an error.
        _ = a.temp

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

        _ = a.__class__
        _ = a.__doc__
