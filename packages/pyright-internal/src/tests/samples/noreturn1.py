# This sample tests the type checker's handling of the NoReturn annotation type.

from typing import Callable, NoReturn, overload


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
        return "hello"
    else:
        func3()


def func5(x: bool) -> NoReturn:
    if x:
        # This should generate an error because the function
        # explicitly yields a value.
        yield 4

    raise Exception()


x1: Callable[[bool], bool] = func2


async def func6() -> NoReturn: ...


async def func7() -> NoReturn:
    await func6()


class A:
    def __new__(cls) -> NoReturn: ...


def func8() -> NoReturn:
    A()


class C:
    def __call__(self) -> NoReturn: ...


def func10() -> NoReturn:
    C()()


@overload
def func11() -> NoReturn: ...


@overload
def func11(x: int) -> None: ...


def func11(x: int = 0) -> NoReturn | None: ...


def func12() -> NoReturn:
    func11()


def func13() -> NoReturn:
    # This should generate an error.
    func11(0)


def func14(x: int) -> NoReturn: ...


def func15():
    # This should generate an error.
    return func14()
