# This sample covers the case where a function accepts a generic callable
# as a parameter along with another parameter that uses the same type variable
# and a caller provides an overloaded function as an argument.

from typing import Any, Callable, TypeVar, Union, overload

T = TypeVar("T")


@overload
def ff1(real: float):
    ...


@overload
def ff1(real: str):
    ...


def ff1(real: Union[float, str]) -> None:
    ...


def fun(f: Callable[[T], Any], p: T):
    return f(p)


fun(ff1, 4)
fun(ff1, "4")

# This should generate an error because a "bytes" argument
# doesn't match any of the overloads.
fun(ff1, b"")


map(complex, ["3j", "4"])

# This should generate an error because a "bytes" argument
# doesn't match any of the overloads in the "complex" constructor.
map(complex, [b"3j"])
