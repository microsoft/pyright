# This sample tests overload matching when an invariant container is
# specialized with Any.

from typing import Any, overload


@overload
def overloaded(value: list[int]) -> list[int]:
    ...


@overload
def overloaded(value: list[str]) -> list[str]:
    ...


def overloaded(value: Any) -> list[Any]:
    return []


def check(value: list[Any]) -> None:
    reveal_type(overloaded(value), expected_text="Any")
