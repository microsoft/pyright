# This sample tests negative type narrowing for two-argument forms of TypeGuard.

from typing import Literal, TypeGuard, Union


def is_str1(val: Union[str, int]) -> TypeGuard[str, int]:
    return isinstance(val, str)


def func1(val: Union[str, int]):
    if is_str1(val):
        t1: Literal["str"] = reveal_type(val)
    else:
        t2: Literal["int"] = reveal_type(val)


def is_str2(val: Union[str, int]) -> TypeGuard[str]:
    return isinstance(val, str)


def func2(val: Union[str, int]):
    if is_str2(val):
        t1: Literal["str"] = reveal_type(val)
    else:
        t2: Literal["str | int"] = reveal_type(val)


def is_true(o: object) -> TypeGuard[Literal[True], Literal[False]]:
    ...


def func3(val: object):
    if not is_true(val):
        t1: Literal["Literal[False]"] = reveal_type(val)
    else:
        t2: Literal["Literal[True]"] = reveal_type(val)

    t3: Literal["bool"] = reveal_type(val)
