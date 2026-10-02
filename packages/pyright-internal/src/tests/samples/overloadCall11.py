# This sample records the known conformance limitation restored by rolling back
# #11601/#11732, not the required semantics of an ambiguous invariant-container call.

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
    reveal_type(result, expected_text="list[int]")

    # Conformance requires assignability to BOTH retained return types and permits
    # operations supported by either. First-match inference currently fails these checks.
    int_result: list[int] = result
    # This should generate an error: the known rollback limitation rejects list[str].
    str_result: list[str] = result
    result.append(1)
    # This should generate an error: string append is valid for a retained materialization.
    result.append("value")
