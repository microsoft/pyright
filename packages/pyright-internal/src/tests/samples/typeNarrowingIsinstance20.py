# This sample tests the case where an isinstance type narrowing is used
# with a generic class with a type parameter that has a default value.

from typing import Generic
from typing_extensions import TypeVar  # pyright: ignore[reportMissingModuleSource]


T = TypeVar("T", bound=int, default=int)


class ClassA(Generic[T]): ...


def func1(obj: object):
    if isinstance(obj, ClassA):
        reveal_type(obj, expected_text="ClassA[Unknown]")
