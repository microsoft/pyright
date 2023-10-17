# This sample tests basic type narrowing behavior for
# the isinstance call.

from types import NoneType
from typing import Any, TypedDict


def func1(x: list[str] | int):
    if isinstance(x, list):
        reveal_type(x, expected_text="list[str]")
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


def func4(x: int | SomeTypedDict):
    if isinstance(x, dict):
        reveal_type(x, expected_text="SomeTypedDict")
    else:
        reveal_type(x, expected_text="int")


def func5(x: int | str | complex):
    if isinstance(x, (int, str)):
        reveal_type(x, expected_text="int | str")
    else:
        reveal_type(x, expected_text="complex | float")


def func6(x: type[int] | type[str] | type[complex]):
    if issubclass(x, (int, str)):
        reveal_type(x, expected_text="type[int] | type[str]")
    else:
        reveal_type(x, expected_text="type[complex] | type[float]")


def func7(x: int | SomeTypedDict | None):
    if isinstance(x, (dict, type(None))):
        reveal_type(x, expected_text="SomeTypedDict | None")
    else:
        reveal_type(x, expected_text="int")


def func8(x: type[int] | type[SomeTypedDict] | type[None]):
    if issubclass(x, (dict, type(None))):
        reveal_type(x, expected_text="type[SomeTypedDict] | type[None]")
    else:
        reveal_type(x, expected_text="type[int]")


def func9(x: int | None):
    if isinstance(x, NoneType):
        reveal_type(x, expected_text="None")
    else:
        reveal_type(x, expected_text="int")


def func10(x: type[int] | type[None]):
    if issubclass(x, NoneType):
        reveal_type(x, expected_text="type[None]")
    else:
        reveal_type(x, expected_text="type[int]")
