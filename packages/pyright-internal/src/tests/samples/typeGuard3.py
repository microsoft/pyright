# This sample tests the StrictTypeGuard form.

from typing import Any, Literal, Mapping, Sequence, TypeVar, Union
from typing_extensions import StrictTypeGuard


def is_str1(val: Union[str, int]) -> StrictTypeGuard[str]:
    return isinstance(val, str)


def func1(val: Union[str, int]):
    if is_str1(val):
        reveal_type(val, expected_text="str")
    else:
        reveal_type(val, expected_text="int")


def is_true(o: object) -> StrictTypeGuard[Literal[True]]:
    ...


def func2(val: bool):
    if not is_true(val):
        reveal_type(val, expected_text="bool")
    else:
        reveal_type(val, expected_text="Literal[True]")

    reveal_type(val, expected_text="bool")


def is_list(val: object) -> StrictTypeGuard[list[Any]]:
    return isinstance(val, list)


def func3(val: dict[str, str] | list[str] | list[int] | Sequence[int]):
    if is_list(val):
        reveal_type(val, expected_text="list[str] | list[int] | list[Any]")
    else:
        reveal_type(val, expected_text="dict[str, str] | Sequence[int]")


def func4(val: dict[str, str] | list[str] | list[int] | tuple[int]):
    if is_list(val):
        reveal_type(val, expected_text="list[str] | list[int]")
    else:
        reveal_type(val, expected_text="dict[str, str] | tuple[int]")


_K = TypeVar("_K")
_V = TypeVar("_V")


def is_dict(val: Mapping[_K, _V]) -> StrictTypeGuard[dict[_K, _V]]:
    return isinstance(val, dict)


def func5(val: dict[_K, _V] | Mapping[_K, _V]):
    if not is_dict(val):
        reveal_type(val, expected_text="Mapping[_K@func5, _V@func5]")
    else:
        reveal_type(val, expected_text="dict[_K@func5, _V@func5]")


def is_cardinal_direction(val: str) -> StrictTypeGuard[Literal["N", "S", "E", "W"]]:
    return val in ("N", "S", "E", "W")


def func6(direction: Literal["NW", "E"]):
    if is_cardinal_direction(direction):
        reveal_type(direction, expected_text="Literal['E']")
    else:
        reveal_type(direction, expected_text="Literal['NW']")


class Animal:
    ...


class Kangaroo(Animal):
    ...


class Koala(Animal):
    ...


T = TypeVar("T")


def is_marsupial(val: Animal) -> StrictTypeGuard[Kangaroo | Koala]:
    return isinstance(val, Kangaroo | Koala)


# This should generate an error because list[T] isn't assignable to list[T | None].
def has_no_nones(
    val: list[T | None],
) -> StrictTypeGuard[list[T]]:
    return None not in val
