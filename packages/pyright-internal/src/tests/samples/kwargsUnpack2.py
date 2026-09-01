# This sample tests the handling of Unpack[TypedDict] with a **kwargs
# parameter when the TypedDict is generic and specialized at the parameter
# declaration. The type argument must be substituted into the expanded
# keyword parameters (both for display and for call argument checking).

from typing import Generic, TypeVar
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    TypedDict,
    Unpack,
)

T = TypeVar("T")


class TD(TypedDict, Generic[T]):
    t: T


def func(**kwargs: Unpack[TD[int]]) -> None:
    v = kwargs["t"]
    reveal_type(v, expected_text="int")


reveal_type(func, expected_text="(**kwargs: **TD[int]) -> None")


def caller() -> None:
    func(t=1)

    # This should generate an error because t must be an int.
    func(t="bad")

    # This should generate an error because t is required.
    func()
