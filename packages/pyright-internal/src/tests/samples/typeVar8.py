# This sample tests the handling of a TypeVar symbol that is
# not representing another type.

from typing import Literal, TypeVar, Union


T = TypeVar("T")
S = TypeVar("S", bound=str)

# In these cases, the TypeVar symbol simply represents the TypeVar
# object itself, rather than representing a type variable.
T.__name__
S.__name__
S.__bound__


def func1(x: bool, a: T, b: S) -> Union[T, S]:
    t1: Literal["str"] = reveal_type(T.__name__)
    t2: Literal["str"] = reveal_type(S.__name__)

    # This should generate an error
    a.__name__

    # This should generate an error
    b.__name__

    if x:
        return a
    else:
        return b
