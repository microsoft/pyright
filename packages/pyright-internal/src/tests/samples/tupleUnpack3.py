# This sample verifies that a unpacked tuple that contains TypeVars
# and is later specialized is honored.

from typing import Protocol, TypeVar, Callable, Protocol, Any
from typing_extensions import Unpack  # pyright: ignore[reportMissingModuleSource]


class SupportsSum(Protocol):
    def __add__(self, __x: Any) -> Any: ...


T = TypeVar("T", bound=SupportsSum)


def wrapped_summation(start: T) -> Callable[[Unpack[tuple[T, ...]]], T]:
    def inner_func(*values: T):
        return sum(values, start=start)

    return inner_func


int_sum = wrapped_summation(3)

reveal_type(int_sum, expected_text="(*tuple[int, ...]) -> int")

# This should generate an error.
int_sum(3.14)
