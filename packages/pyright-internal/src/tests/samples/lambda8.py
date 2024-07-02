# This sample tests the case where a lambda is passed to a generic
# Callable with two different type variables.

from typing import Callable, Generic, TypeVar

T = TypeVar("T")
R = TypeVar("R")


class A(Generic[T, R]):
    def __init__(self, x: Callable[[T], R], y: T): ...


class B(Generic[R]):
    def __init__(self, x: Callable[[T], R], y: T): ...


reveal_type(A(lambda x: x, 123), expected_text="A[int, int]")
reveal_type(B(lambda x: x, 123), expected_text="B[int]")
