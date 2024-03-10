# This sample tests the case where a variadic TypeVar is used in
# conjunction with a keyword-only parameter. It also tests protocol
# invariance validation when a TypeVarTuple is used in the protocol
# along with a non-variadic TypeVar.

# pyright: strict

from typing import Protocol, TypeVar
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    TypeVarTuple,
    Unpack,
)

T = TypeVar("T")
Ts = TypeVarTuple("Ts")


class CallbackA(Protocol[*Ts, T]):
    def __call__(self, *args: *Ts, keyed: T) -> tuple[Unpack[Ts], T]: ...


def example(a: int, b: str, *, keyed: bool) -> tuple[int, str, bool]:
    return (a, b, keyed)


a: CallbackA[int, str, bool] = example

reveal_type(
    a, expected_text="(a: int, b: str, *, keyed: bool) -> tuple[int, str, bool]"
)
