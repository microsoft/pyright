# This sample tests the case where a union of callables is passed
# to a generic function and the parameter types are subtypes of
# each other.

from typing import Any, Callable, Generic, TypeVar

T_contra = TypeVar("T_contra", contravariant=True)


class Thing1:
    prop1: str


class Thing2:
    prop1: str
    prop2: str


class ClassA(Generic[T_contra]):
    def __init__(self, callback: Callable[[T_contra], Any]) -> None: ...


def func1(cb: Callable[[Thing1], Any] | Callable[[Thing1 | Thing2], Any]):
    reveal_type(ClassA(cb), expected_text="ClassA[Thing1]")
