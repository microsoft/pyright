# This sample tests the isinstance narrowing when the list
# of classes includes a type defined by a type variable.

from typing import Any, TypeVar

T = TypeVar("T")


def func1(cls: type[T], obj: Any) -> T:
    assert isinstance(obj, cls)
    reveal_type(obj, expected_text="T@func1")
    return obj


v1 = func1(int, 3)
reveal_type(v1, expected_text="int")


def func2(klass: type[T], obj: T | int) -> T:
    assert isinstance(obj, klass)
    reveal_type(obj, expected_text="object*")
    return obj


v2 = func2(str, 3)
reveal_type(v2, expected_text="str")
