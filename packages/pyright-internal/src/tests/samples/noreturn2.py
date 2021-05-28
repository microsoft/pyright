# This sample tests that the NoReturn logic is able to handle
# union types in call expressions.

from typing import NoReturn, Union


def f() -> NoReturn:
    raise TypeError


class B(object):
    def always_noreturn(self) -> NoReturn:
        f()

    def sometimes_noreturn(self) -> NoReturn:
        raise TypeError


class C(object):
    def always_noreturn(self) -> NoReturn:
        f()

    def sometimes_noreturn(self) -> int:
        return 0


class A(object):
    def __init__(self):
        # Note the union type declaration here.
        self._B_or_C: Union[B, C] = B()

    def m3(self) -> NoReturn:
        self._B_or_C.always_noreturn()

    def m4(self) -> int:
        x = self._B_or_C.sometimes_noreturn()
        return x
