# This sample tests the case where a tuple including an unpacked
# TypeVarTuple is used in an unpacked argument and assigned to another
# TypeVarTuple parameter.

# Enable experimental features to support Union[*Ts].
# pyright: enableExperimentalFeatures=true

from typing import TypeVar, TypeVarTuple, Union, Unpack

T = TypeVar("T")
Ts = TypeVarTuple("Ts")


def f(*args: Unpack[Ts]) -> Union[Unpack[Ts]]: ...


def g(x: tuple[T, Unpack[Ts]]) -> Union[T, Unpack[Ts]]:
    f(*x)
    return x[0]
