# This sample tests the case where bidirectional type inference is used
# for a call expression that returns a callable and requires bidirectional
# type inference to determine the desired results and the expected type
# is a union that includes some non-callable types.

from typing import Callable, Literal, TypeVar

ABC = Literal["a", "b", "c"]
T = TypeVar("T")


def func1(x: T | Callable[[], T]) -> Callable[[], T]: ...


def func2(a: Callable[[], ABC] | ABC, b: ABC | Callable[[], ABC]):
    v1 = func1(a)
    reveal_type(v1, expected_text="() -> str")

    v2 = func1(b)
    reveal_type(v2, expected_text="() -> str")

    v3: Callable[[], ABC] = func1(a)
    reveal_type(v3, expected_text="() -> Literal['a', 'b', 'c']")

    v4: Callable[[], ABC] = func1(b)
    reveal_type(v4, expected_text="() -> Literal['a', 'b', 'c']")
