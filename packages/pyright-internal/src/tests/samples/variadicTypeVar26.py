# This sample tests the case where a `*args: *Ts` parameter captures
# a callable with an indeterminate number of parameters because
# some of them have default arguments.

from typing import Callable, Literal, TypeVar, TypeVarTuple

T = TypeVar("T")
Ts = TypeVarTuple("Ts")


def func1(x: int, y: str = "", z: int | None = None) -> None: ...


def func2(callback: Callable[[*Ts], None], *args: *Ts) -> tuple[*Ts]: ...


v1 = func2(func1, 1)
reveal_type(v1, expected_text="tuple[int]")

v2 = func2(func1, 1, "")
reveal_type(v2, expected_text="tuple[int, str]")

v3 = func2(func1, 1, "", 3)
reveal_type(v3, expected_text="tuple[int, str, int]")

v4 = func2(func1, 1, "", None)
reveal_type(v4, expected_text="tuple[int, str, None]")

# This should generate an error.
func2(func1)

# This should generate an error.
func2(func1, "")

# This should generate an error.
func2(func1, 3, "", None, None)


def func3(callback: Callable[[*Ts], None]) -> tuple[*Ts]: ...


v5 = func3(func1)
reveal_type(v5, expected_text="tuple[int, str, int | None]")


def func4(a: Literal["day", "hour"]) -> None: ...


def func5(x: bool):
    func2(func4, "day" if x else "hour")


def func6(x: T, y: T, z: int | None = None) -> None: ...


def func7(x: T, y: T) -> None:
    func2(func6, x, y)
