# This sample tests constructor-owned type variables in contextual error recovery.

from collections import deque
from collections.abc import Iterator
from typing import Generic, Self, TypeVar
from typing_extensions import TypeVar as TypeVarWithDefault

T = TypeVar("T")
DefaultT = TypeVarWithDefault("DefaultT", default=int)
_marker = object()


def last(iterable, default=_marker):
    try:
        if getattr(iterable, "__reversed__", None):
            return next(reversed(iterable))
        return deque(iterable, maxlen=1)[-1]
    except (IndexError, StopIteration):
        if default is _marker:
            raise ValueError("empty")
        return default


reveal_type(last, expected_text="(iterable: Unknown, default: object = _marker) -> (Unknown | object)")


def control(values: list[int]):
    pool = enumerate(values)
    result = last(pool, default=(0, None))
    reveal_type(result, expected_text="Unknown | tuple[int, int] | tuple[Literal[0], None]")
    index, item = result
    reveal_type(index, expected_text="Unknown | int")
    reveal_type(item, expected_text="Unknown | int | None")


def reversed_item(values):
    return next(reversed(values))


def call_order(integers: list[int], strings: list[str], pool: enumerate[int]):
    reveal_type(reversed_item(integers), expected_text="int")
    reveal_type(reversed_item(pool), expected_text="Unknown")
    reveal_type(reversed_item(strings), expected_text="str")
    reveal_type(reversed_item(pool), expected_text="Unknown")
    reveal_type(reversed_item(integers), expected_text="int")


def valid(values: list[T]):
    reveal_type(reversed(values), expected_text="Iterator[T@valid]")
    reveal_type(next(reversed(values)), expected_text="T@valid")
    reverse: Iterator[T] = reversed(values)
    reveal_type(next(reverse), expected_text="T@valid")


def invalid(values: enumerate[int]):
    # This should generate two errors because enumerate is not reversible.
    result = next(reversed(values))
    reveal_type(result, expected_text="Unknown")


class DefaultIterator(Generic[DefaultT]):
    def __new__(cls, values: list[DefaultT]) -> Self: ...

    def __next__(self) -> DefaultT: ...


def defaults(values: list[T]):
    reveal_type(next(DefaultIterator(values)), expected_text="T@defaults")
    # This should generate an error, but recovery should retain the default.
    result = next(DefaultIterator(None))
    reveal_type(result, expected_text="int")
    # This should generate an error, but explicit type arguments remain intact.
    explicit = next(DefaultIterator[str](None))
    reveal_type(explicit, expected_text="str")
