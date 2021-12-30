# This sample tests the two-argument form of TypeGuard with the second
# argument of NoReturn.

from typing import Literal, NoReturn, Sequence, TypeGuard, TypeVar, Union


def validate_is_str(val: object) -> TypeGuard[str, NoReturn]:
    if not isinstance(val, str):
        raise Exception()
    return True


def func1(val: Union[str, int]):
    validate_is_str(val)
    t1: Literal["str"] = reveal_type(val)


def func2(val: object):
    if validate_is_str(val):
        t1: Literal["str"] = reveal_type(val)
    else:
        t2: Literal["Never"] = reveal_type(val)


_T = TypeVar("_T")


def validate_no_nones(
    val: Sequence[Union[_T, None]]
) -> TypeGuard[Sequence[_T], NoReturn]:
    if len([x for x in val if x is not None]) > 0:
        raise Exception()
    return True


def func3(val: Sequence[Union[int, None]]):
    validate_no_nones(val)
    t1: Literal["Sequence[int]"] = reveal_type(val)
