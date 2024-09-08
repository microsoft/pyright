# This sample tests the case where a symbol with type `<some type>|Any`
# is narrowed using an `isinstance` type guard.

from typing import Any


def func1(val: Any):
    if isinstance(val, str):
        reveal_type(val, expected_text="str")
    else:
        reveal_type(val, expected_text="Any")


def func2(val: str):
    if isinstance(val, str):
        reveal_type(val, expected_text="str")
    else:
        reveal_type(val, expected_text="Never")


def func3(val: str | int):
    if isinstance(val, str):
        reveal_type(val, expected_text="str")
    else:
        reveal_type(val, expected_text="int")


def func4(val: str | Any):
    if isinstance(val, str):
        reveal_type(val, expected_text="str")
    else:
        reveal_type(val, expected_text="Any")


def func5(val: str | int | Any):
    if isinstance(val, str):
        reveal_type(val, expected_text="str")
    else:
        reveal_type(val, expected_text="int | Any")


def func6(val: list[str] | Any):
    if isinstance(val, list):
        reveal_type(val, expected_text="list[str] | list[Unknown]")
    else:
        reveal_type(val, expected_text="Any")
