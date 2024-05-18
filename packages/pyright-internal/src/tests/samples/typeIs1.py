# This sample tests the TypeIs form.

from typing import Any, Callable, Literal, Mapping, Sequence, TypeVar, Union
from typing_extensions import TypeIs  # pyright: ignore[reportMissingModuleSource]


def is_str1(val: Union[str, int]) -> TypeIs[str]:
    return isinstance(val, str)


def func1(val: Union[str, int]):
    if is_str1(val):
        reveal_type(val, expected_text="str")
    else:
        reveal_type(val, expected_text="int")


def is_true(o: object) -> TypeIs[Literal[True]]: ...


def func2(val: bool):
    if not is_true(val):
        reveal_type(val, expected_text="bool")
    else:
        reveal_type(val, expected_text="Literal[True]")

    reveal_type(val, expected_text="bool")


def is_list(val: object) -> TypeIs[list[Any]]:
    return isinstance(val, list)


def func3(val: dict[str, str] | list[str] | list[int] | Sequence[int]):
    if is_list(val):
        reveal_type(val, expected_text="list[str] | list[int]")
    else:
        reveal_type(val, expected_text="dict[str, str] | Sequence[int]")


def func4(val: dict[str, str] | list[str] | list[int] | tuple[int]):
    if is_list(val):
        reveal_type(val, expected_text="list[str] | list[int]")
    else:
        reveal_type(val, expected_text="dict[str, str] | tuple[int]")


_K = TypeVar("_K")
_V = TypeVar("_V")


def is_dict(val: Mapping[_K, _V]) -> TypeIs[dict[_K, _V]]:
    return isinstance(val, dict)


def func5(val: dict[_K, _V] | Mapping[_K, _V]):
    if not is_dict(val):
        reveal_type(val, expected_text="Mapping[_K@func5, _V@func5]")
    else:
        reveal_type(val, expected_text="dict[_K@func5, _V@func5]")


def is_cardinal_direction(val: str) -> TypeIs[Literal["N", "S", "E", "W"]]:
    return val in ("N", "S", "E", "W")


def func6(direction: Literal["NW", "E"]):
    if is_cardinal_direction(direction):
        reveal_type(direction, expected_text="Literal['E']")
    else:
        reveal_type(direction, expected_text="Literal['NW']")


class Animal: ...


class Kangaroo(Animal): ...


class Koala(Animal): ...


T = TypeVar("T")


def is_marsupial(val: Animal) -> TypeIs[Kangaroo | Koala]:
    return isinstance(val, Kangaroo | Koala)


# This should generate an error because list[T] isn't consistent with list[T | None].
def has_no_nones(val: list[T | None]) -> TypeIs[list[T]]:
    return None not in val


def takes_int_typeis(f: Callable[[object], TypeIs[int]]) -> None:
    pass


def int_typeis(val: object) -> TypeIs[int]:
    return isinstance(val, int)


def bool_typeis(val: object) -> TypeIs[bool]:
    return isinstance(val, bool)


takes_int_typeis(int_typeis)

# This should generate an error because TypeIs is invariant.
takes_int_typeis(bool_typeis)


def is_two_element_tuple(val: tuple[T, ...]) -> TypeIs[tuple[T, T]]:
    return len(val) == 2


def func7(names: tuple[str, ...]):
    if is_two_element_tuple(names):
        reveal_type(names, expected_text="tuple[str, str]")
    else:
        reveal_type(names, expected_text="tuple[str, ...]")


def is_int(obj: type) -> TypeIs[type[int]]: ...


def func8(x: type) -> None:
    if is_int(x):
        reveal_type(x, expected_text="type[int]")
