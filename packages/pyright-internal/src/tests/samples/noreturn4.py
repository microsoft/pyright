# This sample verifies that a `NoReturn` type can be assigned
# to any other type.

from typing import Callable, NoReturn, TypeVar


_T = TypeVar("_T", int, str)


def func1(x: Callable[[NoReturn], None]): ...


def func2(x: int) -> NoReturn: ...


def func3(x: _T) -> _T:
    return x


def func4(x: NoReturn):
    v1: object = x
    v2: int = x
    v3: str | int = x
    v4: None = x
    v5: Callable[[int, str], str] = x
    func1(func2)
    func3(x)
