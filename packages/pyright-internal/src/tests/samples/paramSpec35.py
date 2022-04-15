# This sample ensures that when solving for a ParamSpec, all assignments
# are consistent.

from typing import Callable, ParamSpec

P = ParamSpec("P")


def func1(x: Callable[P, int], y: Callable[P, int]) -> Callable[P, bool]:
    ...


def a1(p0: int) -> int:
    ...


def a2(p0: int, p2: str) -> int:
    ...

func1(a1, a1)
func1(a2, a2)

# This should generate an error because a1 and a2 are not compatible.
func1(a1, a2)
