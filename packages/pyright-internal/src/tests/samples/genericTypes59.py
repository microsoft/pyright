# This sample tests the handling of a union that includes both
# T and a generic class parameterized by T. This case is indeterminate
# according to PEP 484, but pyright has code in place to find the
# "least complex" answer.

from typing import Generic, TypeVar, Union

T = TypeVar("T")


class Wrapper(Generic[T]):
    ...


def ensure_wrapped(item: Union[T, Wrapper[T]]) -> Wrapper[T]:
    ...


def some_func(x: Wrapper[T]) -> Wrapper[T]:
    return ensure_wrapped(x)
