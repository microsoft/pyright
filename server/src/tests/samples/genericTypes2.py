# This sample checks for handling of generic functions.

from typing import TypeVar, Any, Callable, List

T = TypeVar("T")

def for_each(xs: List[T], f: Callable[[T], Any]) -> None:
    for x in xs:
        f(x)

def call_len(x: str) -> None:
    len(x)

# This should generate an error because call_len takes a str,
# which isn't compatible with a List[int].
for_each([1, 2, 3], call_len)

