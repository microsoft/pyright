# This sample tests the TypeGuard using "strict" semantics.

from typing import Any, Literal, Mapping, Sequence, TypeVar, Union
from typing_extensions import TypeGuard


def is_str1(val: Union[str, int]) -> TypeGuard[str]:
    return isinstance(val, str)


def func1(val: Union[str, int]):
    if is_str1(val):
        reveal_type(val, expected_text="str")
    else:
        reveal_type(val, expected_text="int")


def is_true(o: object) -> TypeGuard[Literal[True]]:
    ...


def func2(val: bool):
    if not is_true(val):
        reveal_type(val, expected_text="bool")
    else:
        reveal_type(val, expected_text="Literal[True]")

    reveal_type(val, expected_text="bool")


def is_list(val: object) -> TypeGuard[list[Any]]:
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


def is_dict(val: Mapping[_K, _V]) -> TypeGuard[dict[_K, _V]]:
    return isinstance(val, dict)


def func5(val: dict[_K, _V] | Mapping[_K, _V]):
    if not is_dict(val):
        reveal_type(val, expected_text="Mapping[_K@func5, _V@func5]")
    else:
        reveal_type(val, expected_text="dict[_K@func5, _V@func5]")


def is_cardinal_direction(val: str) -> TypeGuard[Literal["N", "S", "E", "W"]]:
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


def is_marsupial(val: Animal) -> TypeGuard[Kangaroo | Koala]:
    return isinstance(val, Kangaroo | Koala)


class A1:
    ...


class A2(A1):
    ...


class B1:
    ...


class B2(B1):
    ...


class C1:
    ...


class C2(C1):
    ...


def guard1(val: A1 | B1 | C1) -> TypeGuard[A1 | B1]:
    return isinstance(val, (A1, B1))


def func7_1(val: A1 | B1 | C1):
    if guard1(val):
        reveal_type(val, expected_text="A1 | B1")
    else:
        reveal_type(val, expected_text="C1")


def func7_2(val: A2 | B2 | C2):
    if guard1(val):
        reveal_type(val, expected_text="A2 | B2")
    else:
        reveal_type(val, expected_text="C2")


def func7_3(val: A2 | B2 | C2 | Any):
    if guard1(val):
        reveal_type(val, expected_text="A2 | B2 | A1 | B1")
    else:
        reveal_type(val, expected_text="C2 | Any")


def guard2(val: A1 | B1 | C1) -> TypeGuard[A2 | B2]:
    return isinstance(val, (A2, B2))


def func8_1(val: A1 | B1 | C1):
    if guard2(val):
        reveal_type(val, expected_text="A2 | B2")
    else:
        reveal_type(val, expected_text="A1 | B1 | C1")


def func8_2(val: A2 | B2 | C2):
    if guard2(val):
        reveal_type(val, expected_text="A2 | B2")
    else:
        reveal_type(val, expected_text="C2")


def func8_3(val: A2 | B2 | C2 | Any):
    if guard2(val):
        reveal_type(val, expected_text="A2 | B2")
    else:
        reveal_type(val, expected_text="C2 | Any")


def guard3(val: A2 | B2 | C2) -> TypeGuard[A2 | B2 | Any]:
    return isinstance(val, (A1, B1))


def func3_1(val: A2 | C2):
    if guard3(val):
        reveal_type(val, expected_text="A2 | C2")
    else:
        reveal_type(val, expected_text="C2")


def func3_2(val: A2 | B2 | C2 | Any):
    if guard3(val):
        reveal_type(val, expected_text="A2 | B2 | C2 | Any")
    else:
        reveal_type(val, expected_text="C2 | Any")


def guard4(o: type) -> TypeGuard[type[A1]]:
    ...


def func4_1(cls: type):
    if guard4(cls):
        reveal_type(cls, expected_text="type[A1]")
    else:
        reveal_type(cls, expected_text="type")
