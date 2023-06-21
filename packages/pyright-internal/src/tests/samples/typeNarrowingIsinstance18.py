# This sample tests the case where a filter (guard) type has a subtype
# relationship to the type of the variable being filtered but the
# type arguments sometimes mean that it cannot be a subtype.

from typing import Generic, NamedTuple, TypeVar

T = TypeVar("T")


class NT1(NamedTuple, Generic[T]):
    pass


def func1(val: NT1[str] | tuple[int, int]):
    if isinstance(val, NT1):
        reveal_type(val, expected_text="NT1[str]")
    else:
        reveal_type(val, expected_text="tuple[int, int]")


class NT2(NamedTuple, Generic[T]):
    a: T
    b: str


def func2(val: NT2[str] | tuple[int, int]):
    if isinstance(val, NT2):
        reveal_type(val, expected_text="NT2[str]")
    else:
        reveal_type(val, expected_text="tuple[int, int]")


def func3(val: NT2[str] | tuple[int, str]):
    if isinstance(val, NT2):
        reveal_type(val, expected_text="NT2[str] | NT2[Unknown]")
    else:
        reveal_type(val, expected_text="tuple[int, str]")


class NT3(NamedTuple, Generic[T]):
    a: T
    b: T


def func4(val: NT3[str] | tuple[int, int]):
    if isinstance(val, NT3):
        reveal_type(val, expected_text="NT3[str] | NT3[Unknown]")
    else:
        reveal_type(val, expected_text="tuple[int, int]")


def func5(val: NT3[str] | tuple[str, str, str]):
    if isinstance(val, NT3):
        reveal_type(val, expected_text="NT3[str]")
    else:
        reveal_type(val, expected_text="tuple[str, str, str]")


def func6(val: NT3[str] | tuple[str, ...]):
    if isinstance(val, NT3):
        reveal_type(val, expected_text="NT3[str] | NT3[Unknown]")
    else:
        reveal_type(val, expected_text="tuple[str, ...]")
