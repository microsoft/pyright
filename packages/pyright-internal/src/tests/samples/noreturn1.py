# This sample tests the type checker's handling of the NoReturn annotation type.

from typing import NoReturn


# This should generate an error because the function
# implicitly returns None.
def func1() -> NoReturn:
    pass


def func2(x: bool) -> NoReturn:
    if x:
        # This should generate an error because the function
        # explicitly returns a value.
        return 4

    raise Exception()


def func3() -> NoReturn:
    raise Exception()


def func4(x: bool) -> str:
    if x:
        return 'hello'
    else:
        func3()


def func5(x: bool) -> NoReturn:
    if x:
        # This should generate an error because the function
        # explicitly yields a value.
        yield 4

    raise Exception()

