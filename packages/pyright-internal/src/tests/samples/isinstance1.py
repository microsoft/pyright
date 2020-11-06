# This sample tests basic type narrowing behavior for
# the isinstance call.

from typing import Any, List, Literal, TypedDict, Union


def func1(x: Union[List[str], int]):
    if isinstance(x, list):
        t1: Literal["List[str]"] = reveal_type(x)
    else:
        t2: Literal["int"] = reveal_type(x)


def func2(x: Any):
    if isinstance(x, list):
        t1: Literal["list[Unknown]"] = reveal_type(x)
    else:
        t2: Literal["Any"] = reveal_type(x)


def func3(x):
    if isinstance(x, list):
        t1: Literal["list[Unknown]"] = reveal_type(x)
    else:
        t2: Literal["Unknown"] = reveal_type(x)


class SomeTypedDict(TypedDict):
    name: str


def func4(x: Union[int, SomeTypedDict]):
    if isinstance(x, dict):
        t1: Literal["SomeTypedDict"] = reveal_type(x)
    else:
        t2: Literal["int"] = reveal_type(x)
