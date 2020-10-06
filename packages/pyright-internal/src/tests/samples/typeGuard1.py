# This sample tests the TypeGuard functionality
# that allows user-defined functions to perform
# conditional type narrowing.

# pyright: reportMissingModuleSource=false

import os
from typing import Any, List, Literal, Tuple, TypeVar, Union
from typing_extensions import TypeGuard

_T = TypeVar("_T")


def is_two_element_tuple(a: Tuple[_T, ...]) -> TypeGuard[Tuple[_T, _T]]:
    return True


def func1(a: Tuple[int, ...]):
    if is_two_element_tuple(a):
        t1: Literal["Tuple[int, int]"] = reveal_type(a)
    else:
        t2: Literal["Tuple[int, ...]"] = reveal_type(a)


def is_string_list(val: List[Any], allow_zero_entries: bool) -> TypeGuard[List[str]]:
    if allow_zero_entries and len(val) == 0:
        return True
    return all(isinstance(x, str) for x in val)


def func2(a: List[Union[str, int]]):
    if is_string_list(a, True):
        t1: Literal["List[str]"] = reveal_type(a)
    else:
        t2: Literal["List[str | int]"] = reveal_type(a)


# This should generate an error because TypeGuard
# has no type argument.
def bad1(a: int) -> TypeGuard:
    return True


# This should generate an error because TypeGuard
# has too many type arguments.
def bad2(a: int) -> TypeGuard[str, int]:
    return True


# This should generate an error because TypeGuard
# does not accept an elipsis.
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
