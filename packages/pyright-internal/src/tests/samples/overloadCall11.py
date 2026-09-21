# Ambiguous invariant arguments retain both usable overload results without
# erasing their containers or merging them into an invariant-incompatible union.

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
    result = overloaded(value)
    reveal_type(result, expected_text="OverloadResult[list[int], list[str]]")

    # Conformance requires assignability to BOTH retained return types and permits
    # operations supported by either.
    int_result: list[int] = result
    str_result: list[str] = result
    result.append(1)
    result.append("value")
