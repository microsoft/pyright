# This sample tests that user-defined TypeGuard can
# be used in an overloaded function.

from enum import Enum
from typing import Literal, overload
from typing_extensions import TypeGuard


class TypeGuardMode(Enum):
    NoTypeGuard = 0
    TypeGuard = 1


@overload
def is_int(obj: object, mode: Literal[TypeGuardMode.NoTypeGuard]) -> bool:
    ...


@overload
def is_int(obj: object, mode: Literal[TypeGuardMode.TypeGuard]) -> TypeGuard[int]:
    ...


def is_int(obj: object, mode: TypeGuardMode) -> bool | TypeGuard[int]:
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
        reveal_type(val, expected_text="str")
