# This sample tests the assignment of heterogeneous tuples
# to homogeneous tuple types.

from typing import Callable


def func1(values: tuple[str, ...]): ...


# This should generate an error.
func1(("", False))

# This should generate an error.
func1((False, ""))


def func2(x: tuple[int]) -> None: ...


def func3(x: tuple[()]) -> None: ...


def func4(x: tuple[int, ...]) -> None: ...


c1: Callable[[tuple[int]], None]

c1 = func2
c1 = func3  # This should generate an error.
c1 = func4


c2: Callable[[tuple[int, ...]], None]

c2 = func2  # This should generate an error.
c2 = func3  # This should generate an error.
c2 = func4
