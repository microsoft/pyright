# This sample tests support for Concatenate with a ... type argument.

from typing import Callable, Concatenate

TA1 = Callable[Concatenate[int, ...], None]


def func1(cb: Callable[Concatenate[int, str, ...], None]): ...


def func2(cb: TA1): ...


def cb1(x: int, y: str, z: str) -> None: ...


func1(cb1)
func2(cb1)


def cb2(x: int, y: str, *args: int, **kwargs: str) -> None: ...


func1(cb2)
func2(cb2)


def cb3(x: str, y: str) -> None: ...


# This should generate an error.
func1(cb3)

# This should generate an error.
func2(cb3)
