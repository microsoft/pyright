# Used by the developer trace integration tests, not a new analyzer behavior.
from typing import TypeVar, reveal_type

T = TypeVar("T")


def identity(value: T) -> T:
    return value


def narrow(values: list[int | None]) -> list[int]:
    result: list[int] = []
    for value in values:
        if value is not None:
            result.append(identity(value))
    reveal_type(result, expected_text="list[int]")
    return result


items = narrow([1, None])
reveal_type(items, expected_text="list[int]")
