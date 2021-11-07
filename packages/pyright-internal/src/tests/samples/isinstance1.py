# This sample tests basic type narrowing behavior for
# the isinstance call.

from typing import Any, List, Literal, Optional, Type, TypedDict, Union


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


def func5(x: int | str | complex):
    if isinstance(x, (int, str)):
        t1: Literal["int | str"] = reveal_type(x)
    else:
        t2: Literal["complex"] = reveal_type(x)


def func6(x: Type[int] | Type[str] | Type[complex]):
    if issubclass(x, (int, str)):
        t1: Literal["Type[int] | Type[str]"] = reveal_type(x)
    else:
        t2: Literal["Type[complex]"] = reveal_type(x)


def func7(x: Optional[Union[int, SomeTypedDict]]):
    if isinstance(x, (dict, type(None))):
        t1: Literal["SomeTypedDict | None"] = reveal_type(x)
    else:
        t2: Literal["int"] = reveal_type(x)
