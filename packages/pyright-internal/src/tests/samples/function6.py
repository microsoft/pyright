# This sample verifies that functions are treated as though they
# derive from object.

from typing import Callable, overload


@overload
def func1(a: str) -> str: ...


@overload
def func1(a: int) -> int: ...


def func1(a: str | int) -> str | int: ...


def func2(a: str | int) -> str | int: ...


def takes_object(val: object) -> None: ...


takes_object(func1)
takes_object(func2)


def func3(b: Callable[[str], bool]) -> None:
    if b == func1:
        pass

    if b != func2:
        pass
