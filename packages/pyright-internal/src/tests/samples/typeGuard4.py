# This sample tests that user-defined TypeGuard and StrictTypeGuard can
# be used in an overloaded function.

from enum import Enum
from typing import Literal, overload
from typing_extensions import StrictTypeGuard, TypeGuard


class TypeGuardMode(Enum):
    NoTypeGuard = 0
    TypeGuard = 1
    StrictTypeGuard = 2


@overload
def is_int(obj: object, mode: Literal[TypeGuardMode.NoTypeGuard]) -> bool:
    ...


@overload
def is_int(obj: object, mode: Literal[TypeGuardMode.TypeGuard]) -> TypeGuard[int]:
    ...


@overload
def is_int(
    obj: object, mode: Literal[TypeGuardMode.StrictTypeGuard]
) -> StrictTypeGuard[int]:
    ...


def is_int(
    obj: object, mode: TypeGuardMode
) -> bool | TypeGuard[int] | StrictTypeGuard[int]:
    ...


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


def func_stricttypeguard(val: int | str):
    if is_int(val, TypeGuardMode.StrictTypeGuard):
        reveal_type(val, expected_text="int")
    else:
        reveal_type(val, expected_text="str")
