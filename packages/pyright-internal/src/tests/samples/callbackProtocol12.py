# This sample tests the case where a callback protocol uses
# variadic positional arguments and keyword-only or variadic
# keyword arguments, and is assigned to a callback protocol
# with a positional-or-keyword argument of the source's
# positional type and keyword-form name.

from typing import Protocol


class IntArgsBoolKwonly(Protocol):
    def __call__(self, *args: int, a: bool = False) -> None: ...


class IntArgsIntKwonly(Protocol):
    def __call__(self, *args: int, a: int = 0) -> None: ...


class IntArgsBoolKwargs(Protocol):
    def __call__(self, *args: int, **kwargs: bool) -> None: ...


class IntArgsIntKwargs(Protocol):
    def __call__(self, *args: int, **kwargs: int) -> None: ...


class IntArgsIntKwonlyNoDefault(Protocol):
    def __call__(self, *args: int, a: int) -> None: ...


class IntPosorkw(Protocol):
    def __call__(self, a: int) -> None: ...


def func1(cb: IntArgsBoolKwonly):
    # This should generate an error
    x: IntPosorkw = cb


def func2(cb: IntArgsIntKwonly):
    x: IntPosorkw = cb


def func3(cb: IntArgsBoolKwargs):
    # This should generate an error
    x: IntPosorkw = cb


def func4(cb: IntArgsIntKwargs):
    x: IntPosorkw = cb


def func5(cb: IntArgsIntKwonlyNoDefault):
    # This should generate an error
    x: IntPosorkw = cb
