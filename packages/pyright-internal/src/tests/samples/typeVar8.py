# This sample tests the handling of a TypeVar symbol that is
# not representing another type.

from typing import TypeVar


T = TypeVar("T")
S = TypeVar("S", bound=str)

# In these cases, the TypeVar symbol simply represents the TypeVar
# object itself, rather than representing a type variable.
v1 = T.__name__
v2 = S.__name__
v3 = S.__bound__


def func1(x: bool, a: T, b: S) -> T | S:
    reveal_type(T.__name__, expected_text="str")
    reveal_type(S.__name__, expected_text="str")

    # This should generate an error
    v1 = a.__name__

    # This should generate an error
    v2 = b.__name__

    if x:
        return a
    else:
        return b
