# This sample tests the case where an unpacked TypeVarTuple is assigned
# to a non-variadic TypeVar during constraint solving.

# Enable experimental features to support Union[*Ts].
# pyright: enableExperimentalFeatures=true

from typing import TypeVar, Tuple, Union
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    reveal_type,
    TypeVarTuple,
)

T = TypeVar("T")
Ts = TypeVarTuple("Ts")


def func1(*args: T) -> Tuple[T, ...]:
    return args


def func2(x: "Tuple[*Ts]") -> list[Union[*Ts]]:
    r = func1(*x)
    reveal_type(r, expected_text="Tuple[Union[*Ts@func2], ...]")
    v = [i for i in r]
    reveal_type(v, expected_text="list[Union[*Ts@func2]]")
    return v
