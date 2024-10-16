# This sample tests the matching of a traditional *args parameter
# and a *args unpacked Tuple to a *args TypeVarTuple.

from typing import Callable, TypeVar
from typing_extensions import TypeVarTuple  # pyright: ignore[reportMissingModuleSource]

Ts = TypeVarTuple("Ts")
R = TypeVar("R")


def call_with_params(func: Callable[[*Ts], R], *params: *Ts) -> R:
    # This should generate an error because it's missing a *.
    func(params)

    return func(*params)


def callback1(*args: int) -> int: ...


def callback2(*args: *tuple[int, int]) -> int: ...


call_with_params(callback1)
call_with_params(callback1, 1, 2, 3)

# This should generate an error.
call_with_params(callback1, "1")

# This should generate an error.
call_with_params(callback2)

call_with_params(callback2, 1, 1)

# This should generate an error.
call_with_params(callback2, 1, "")


def callback3(*args: *tuple[int, *tuple[str, ...], int]) -> int: ...


# This should generate an error.
call_with_params(callback3)

call_with_params(callback3, 1, 2)

call_with_params(callback3, 1, "hi", 2)

call_with_params(callback3, 1, "hi", "hi", 2)

# This should generate an error.
call_with_params(callback3, 1, 1, 2)


class ClassA:
    @classmethod
    def method1(cls, *shape: *Ts) -> tuple[*Ts]: ...


def func1(target: Callable[[*Ts], int]) -> tuple[*Ts]: ...


def func2(a: int, b: str, /) -> int: ...


def func3(action: Callable[[int, str], int]):
    v1 = func1(func2)
    reveal_type(v1, expected_text="tuple[int, str]")

    v2 = func1(action)
    reveal_type(v2, expected_text="tuple[int, str]")


def func4(*args: *tuple[int, str]): ...


func4(1, "")

# This should generate an error.
func4()

# This should generate an error.
func4(1)

# This should generate an error.
func4(1, "", "")


def func5(*args: *tuple[int, *tuple[str, ...], int]): ...


func5(1, 1)
func5(1, "", 1)
func5(1, "", "", 1)

# This should generate an error.
func5()

# This should generate an error.
func5(1)

# This should generate an error.
func5("")

# This should generate an error.
func5(1, "")

# This should generate an error.
func5(1, "", "")
