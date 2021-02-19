# This sample tests that the NoReturn logic is able to handle
# union types in call expressions.

from typing import NoReturn, Union


def f() -> NoReturn:
    raise TypeError


class B(object):
    def fb(self) -> NoReturn:
        f()


class C(object):
    def fb(self) -> NoReturn:
        f()


class A(object):
    def __init__(self):
        # Note the union type declaration here.
        self._B_or_C: Union[B, C] = B()

    def fa4(self) -> NoReturn:
        self._B_or_C.fb()
