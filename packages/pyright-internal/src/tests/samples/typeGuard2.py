# This sample tests the handling of user-defined type guards (PEP 647)
# when they are used as callback functions.

# pyright: strict, reportMissingModuleSource=false

from typing import Any, Callable, Sequence, TypeVar, overload
from typing_extensions import TypeGuard  # pyright: ignore[reportMissingModuleSource]


_T = TypeVar("_T")


def cb1(obj: object) -> TypeGuard[int]: ...


def cb2(obj: object) -> bool: ...


def simple_filter(
    val: Sequence[object], fn: Callable[[object], bool]
) -> list[object]: ...


@overload
def overloaded_filter(
    val: Sequence[object], fn: Callable[[object], TypeGuard[_T]]
) -> Sequence[_T]: ...


@overload
def overloaded_filter(
    val: Sequence[object], fn: Callable[[object], bool]
) -> Sequence[object]: ...


def overloaded_filter(
    val: Sequence[object], fn: Callable[[object], Any]
) -> Sequence[Any]: ...


x1 = cb1(1)
reveal_type(x1, expected_text="TypeGuard[int]")

sf1 = simple_filter([], cb1)
reveal_type(sf1, expected_text="list[object]")

sf2 = simple_filter([], cb2)
reveal_type(sf2, expected_text="list[object]")

of1 = overloaded_filter([], cb1)
reveal_type(of1, expected_text="Sequence[int]")

of2 = overloaded_filter([], cb2)
reveal_type(of2, expected_text="Sequence[object]")
