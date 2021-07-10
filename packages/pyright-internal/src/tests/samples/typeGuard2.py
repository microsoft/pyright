# This sample tests the handling of user-defined type guards (PEP 647)
# when they are used as callback functions.

# pyright: strict, reportMissingModuleSource=false

from typing import Any, Callable, List, Literal, Sequence, TypeVar, overload
from typing_extensions import TypeGuard


_T = TypeVar("_T")


def cb1(obj: object) -> TypeGuard[int]:
    ...


def cb2(obj: object) -> bool:
    ...


def simple_filter(list: Sequence[object], fn: Callable[[object], bool]) -> List[object]:
    ...


@overload
def overloaded_filter(
    list: Sequence[object], fn: Callable[[object], TypeGuard[_T]]
) -> Sequence[_T]:
    ...


@overload
def overloaded_filter(
    list: Sequence[object], fn: Callable[[object], bool]
) -> Sequence[object]:
    ...


def overloaded_filter(
    list: Sequence[object], fn: Callable[[object], Any]
) -> Sequence[Any]:
    ...


x1 = cb1(1)
t_x1: Literal["bool"] = reveal_type(x1)

sf1 = simple_filter([], cb1)
t_sf1: Literal["List[object]"] = reveal_type(sf1)

sf2 = simple_filter([], cb2)
t_sf2: Literal["List[object]"] = reveal_type(sf2)

of1 = overloaded_filter([], cb1)
t_of1: Literal["Sequence[int]"] = reveal_type(of1)

of2 = overloaded_filter([], cb2)
t_of2: Literal["Sequence[object]"] = reveal_type(of2)
