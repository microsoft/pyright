# This sample tests the case where a function with an overload
# is passed to a higher-order function and the return type uses
# a nested Callable type.

from typing import overload, Callable


def func1[A, B](f: Callable[[A], B]) -> Callable[[Callable[[], A]], B]: ...


@overload
def func2(v: int) -> None: ...


@overload
def func2(v: str) -> None: ...


def func2(v: int | str) -> None:
    pass


def func3() -> int:
    return 1


v1 = func1(func2)
reveal_type(v1, expected_text="Overload[(() -> int) -> None, (() -> str) -> None]")

v2 = v1(func3)
reveal_type(v2, expected_text="None")

v3 = v1(lambda: 1)
reveal_type(v3, expected_text="None")
