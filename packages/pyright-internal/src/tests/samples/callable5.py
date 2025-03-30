# This sample covers the case where a function accepts a generic callable
# as a parameter along with another parameter that uses the same type variable
# and a caller provides an overloaded function as an argument.

from typing import Any, Callable, TypeVar, overload

T = TypeVar("T")


@overload
def func1(real: float): ...


@overload
def func1(real: str): ...


def func1(real: float | str) -> None: ...


def func2(f: Callable[[T], Any], p: T):
    return f(p)


func2(func1, 4)
func2(func1, "4")

# This should generate an error because a "bytes" argument
# doesn't match any of the overloads.
func2(func1, b"")


map(complex, ["3j", "4"])

# This should generate two errors because a "bytes" argument
# doesn't match any of the overloads in the "complex" constructor.
map(complex, [b"3j"])
