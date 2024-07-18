# This sample tests that members of an inner class that are parameterized
# by type variables from an outer scope are handled correctly.

from typing import Callable, TypeVar

T = TypeVar("T")


def func1(cb: Callable[[], T]) -> T:
    class InnerClass:
        def __init__(self) -> None:
            self.result: T | None = None

        def run(self) -> None:
            self.result = cb()

    reveal_type(InnerClass().result, expected_text="T@func1 | None")

    return cb()
