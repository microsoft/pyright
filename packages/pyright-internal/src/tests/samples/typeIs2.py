# This sample tests the subtyping relationships between TypeIs, TypeGuard,
# and bool.

# pyright: reportMissingModuleSource=false

from typing import Callable

from typing_extensions import TypeGuard, TypeIs

TypeIsInt = Callable[..., TypeIs[int]]
TypeIsFloat = Callable[..., TypeIs[float]]
BoolReturn = Callable[..., bool]
TypeGuardInt = Callable[..., TypeGuard[int]]


def func1(v1: TypeIsInt, v2: TypeIsFloat, v3: BoolReturn, v4: TypeGuardInt):
    a1: TypeIsInt = v1
    a2: TypeIsInt = v2  # Should generate an error
    a3: TypeIsInt = v3  # Should generate an error
    a4: TypeIsInt = v4  # Should generate an error

    b1: TypeIsFloat = v1  # Should generate an error
    b2: TypeIsFloat = v2
    b3: TypeIsFloat = v3  # Should generate an error
    b4: TypeIsFloat = v4  # Should generate an error

    c1: BoolReturn = v1
    c2: BoolReturn = v2
    c3: BoolReturn = v3
    c4: BoolReturn = v4

    d1: TypeGuardInt = v1  # Should generate an error
    d2: TypeGuardInt = v2  # Should generate an error
    d3: TypeGuardInt = v3  # Should generate an error
    d4: TypeGuardInt = v4
