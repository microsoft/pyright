# This sample tests the case where an unpacked TypeVar is used in
# an iterator.

from typing import Any, Callable, TypeVarTuple


Ts = TypeVarTuple("Ts")


def func1(f: Callable[[*Ts], Any], p: tuple[*Ts]):
    f(*p)

    # This should generate an error because p is not unpacked.
    f(p)

    for i in p:
        # This should generate an error.
        f(i)
