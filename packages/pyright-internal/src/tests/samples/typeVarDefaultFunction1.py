# This sample tests support for PEP 696 -- default types for TypeVars.
# In particular, it tests the case where a TypeVarLike goes unsolved
# in a call, and a default value is used rather than Unknown.

from typing import Callable, Generic, Unpack
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    ParamSpec,
    TypeVar,
    TypeVarTuple,
)

T = TypeVar("T", default=str)


def func1(x: int | T) -> list[T]: ...


v1_1 = func1(3.4)
reveal_type(v1_1, expected_text="list[float]")

v1_2 = func1(3)
reveal_type(v1_2, expected_text="list[str]")


P = ParamSpec("P", default=[int, str, str])


class ClassA(Generic[P]):
    def __init__(self, x: Callable[P, None]) -> None: ...


def func2(x: int | ClassA[P]) -> ClassA[P]: ...


def callback1(x: str) -> None: ...


v2_1 = func2(ClassA(callback1))
reveal_type(v2_1, expected_text="ClassA[(x: str)]")


v2_2 = func2(3)
reveal_type(v2_2, expected_text="ClassA[(int, str, str)]")


Ts = TypeVarTuple("Ts", default=Unpack[tuple[int, str, float]])


def func3(x: int | Callable[[*Ts], None]) -> tuple[*Ts]: ...


v3_1 = func3(callback1)
reveal_type(v3_1, expected_text="tuple[str]")

v3_2 = func3(3)
reveal_type(v3_2, expected_text="tuple[int, str, float]")


P2 = ParamSpec("P2", default=...)
P3 = ParamSpec("P3", default="...")
