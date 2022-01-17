# This sample tests basic type narrowing behavior for
# the isinstance call.

from typing import Any, List, Optional, Type, TypedDict, Union


def func1(x: Union[List[str], int]):
    if isinstance(x, list):
        reveal_type(x, expected_text="List[str]")
    else:
        reveal_type(x, expected_text="int")


def func2(x: Any):
    if isinstance(x, list):
        reveal_type(x, expected_text="list[Unknown]")
    else:
        reveal_type(x, expected_text="Any")


def func3(x):
    if isinstance(x, list):
        reveal_type(x, expected_text="list[Unknown]")
    else:
        reveal_type(x, expected_text="Unknown")


class SomeTypedDict(TypedDict):
    name: str


def func4(x: Union[int, SomeTypedDict]):
    if isinstance(x, dict):
        reveal_type(x, expected_text="SomeTypedDict")
    else:
        reveal_type(x, expected_text="int")


def func5(x: int | str | complex):
    if isinstance(x, (int, str)):
        reveal_type(x, expected_text="int | str")
    else:
        reveal_type(x, expected_text="complex")


def func6(x: Type[int] | Type[str] | Type[complex]):
    if issubclass(x, (int, str)):
        reveal_type(x, expected_text="Type[int] | Type[str]")
    else:
        reveal_type(x, expected_text="Type[complex]")


def func7(x: Optional[Union[int, SomeTypedDict]]):
    if isinstance(x, (dict, type(None))):
        reveal_type(x, expected_text="SomeTypedDict | None")
    else:
        reveal_type(x, expected_text="int")
