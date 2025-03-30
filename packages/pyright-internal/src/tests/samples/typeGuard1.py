# This sample tests the TypeGuard functionality
# that allows user-defined functions to perform
# conditional type narrowing.

# pyright: reportMissingModuleSource=false

import os
from typing import Any, Callable, TypeVar

from typing_extensions import TypeGuard  # pyright: ignore[reportMissingModuleSource]

_T = TypeVar("_T")


def is_two_element_tuple(a: tuple[_T, ...]) -> TypeGuard[tuple[_T, _T]]:
    return True


def func1(a: tuple[int, ...]):
    if is_two_element_tuple(a):
        reveal_type(a, expected_text="tuple[int, int]")
    else:
        reveal_type(a, expected_text="tuple[int, ...]")


def is_string_list(val: list[Any], allow_zero_entries: bool) -> TypeGuard[list[str]]:
    if allow_zero_entries and len(val) == 0:
        return True
    return all(isinstance(x, str) for x in val)


def func2(a: list[str | int]):
    if is_string_list(a, True):
        reveal_type(a, expected_text="list[str]")
    else:
        reveal_type(a, expected_text="list[str | int]")


# This should generate an error because TypeGuard
# has no type argument.
def bad1(a: int, b: object) -> TypeGuard:
    # This is a runtime use of TypeGuard and shouldn't generate an error.
    if b is TypeGuard:
        return True
    return True


# This should generate an error because TypeGuard
# has too many type arguments.
def bad2(a: int) -> TypeGuard[str, int]:
    return True


# This should generate an error because TypeGuard
# does not accept an ellipsis.
def bad3(a: int) -> TypeGuard[...]:
    return True


# This should generate an error because TypeGuard
# has does not accept a module.
def bad4(a: int) -> TypeGuard[os]:
    return True


def bad5(a: int) -> TypeGuard[int]:
    # This should generate an error because only
    # bool values can be returned.
    return 3


# This should generate an error because a type guard function must
# accept at least one parameter.
def bad6() -> TypeGuard[int]:
    return True


class ClassA:
    # This should generate an error because a type guard function must
    # accept at least one parameter.
    def method1(self) -> TypeGuard[int]:
        return True


class IsInt:
    def __call__(self, value: Any) -> TypeGuard[int]:
        return isinstance(value, int)


def func3(x: Any):
    i = IsInt()
    if i(x):
        reveal_type(x, expected_text="int")


def is_int(obj: type) -> TypeGuard[type[int]]: ...


def func4(typ: type[_T]) -> _T:
    if not is_int(typ):
        raise Exception("Unsupported type")

    return typ()


def takes_int_typeguard(f: Callable[[object], TypeGuard[int]]) -> None:
    pass


def int_typeguard(val: object) -> TypeGuard[int]:
    return isinstance(val, int)


def bool_typeguard(val: object) -> TypeGuard[bool]:
    return isinstance(val, bool)


def str_typeguard(val: object) -> TypeGuard[str]:
    return isinstance(val, str)


takes_int_typeguard(int_typeguard)
takes_int_typeguard(bool_typeguard)

# This should generate an error because TypeGuard is covariant.
takes_int_typeguard(str_typeguard)


v0 = is_int(int)
v1: bool = v0
v2: int = v0
v3 = v0 & v0
