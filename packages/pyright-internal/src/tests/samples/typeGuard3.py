# This sample tests that user-defined TypeGuard can
# be used in an overloaded function.

from enum import Enum
from typing import Literal, overload
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    TypeGuard,
    TypeIs,
)


class TypeGuardMode(Enum):
    NoTypeGuard = 0
    TypeGuard = 1
    TypeIs = 2


@overload
def is_int(obj: object, mode: Literal[TypeGuardMode.NoTypeGuard]) -> bool: ...


@overload
def is_int(obj: object, mode: Literal[TypeGuardMode.TypeGuard]) -> TypeGuard[int]: ...


@overload
def is_int(obj: object, mode: Literal[TypeGuardMode.TypeIs]) -> TypeIs[int]: ...


def is_int(obj: object, mode: TypeGuardMode) -> bool | TypeGuard[int] | TypeIs[int]: ...


def func_no_typeguard(val: int | str):
    if is_int(val, TypeGuardMode.NoTypeGuard):
        reveal_type(val, expected_text="int | str")
    else:
        reveal_type(val, expected_text="int | str")


def func_typeguard(val: int | str):
    if is_int(val, TypeGuardMode.TypeGuard):
        reveal_type(val, expected_text="int")
    else:
        reveal_type(val, expected_text="int | str")


def func_typeis(val: int | str):
    if is_int(val, TypeGuardMode.TypeIs):
        reveal_type(val, expected_text="int")
    else:
        reveal_type(val, expected_text="str")
