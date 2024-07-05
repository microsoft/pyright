# This sample tests the case where a local NoReturn call depends
# on the inferred type of a local variable.

from typing import NoReturn


class MyClass:
    def no_return(self) -> NoReturn: ...


def client_code() -> NoReturn:
    instance = MyClass()
    instance.no_return()
