# This sample tests that the NoReturn logic is able to handle
# union types in call expressions.

from typing import NoReturn


def func1() -> NoReturn:
    raise TypeError


class B:
    def always_noreturn(self) -> NoReturn:
        func1()

    def sometimes_noreturn(self) -> NoReturn:
        raise TypeError


class C:
    def always_noreturn(self) -> NoReturn:
        func1()

    def sometimes_noreturn(self) -> int:
        return 0


class A:
    def __init__(self):
        # Note the union type declaration here.
        self._B_or_C: B | C = B()

    def m3(self) -> NoReturn:
        self._B_or_C.always_noreturn()

    def m4(self) -> int:
        x = self._B_or_C.sometimes_noreturn()
        return x
