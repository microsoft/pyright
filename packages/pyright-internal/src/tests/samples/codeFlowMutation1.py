# Mutation-only flow records must not consume the contextual return inference budget.

from typing import Literal, TypeVar, assert_type


def preserve(value, flag: bool, data: dict[int, int], index: int):
    if flag:
        data[index] = data[index + 1] = data[index + 2] = data[index + 3] = 1
        data[index + 4] = data[index + 5] = data[index + 6] = data[index + 7] = 2
    if flag:
        data[index] = data[index + 1] = data[index + 2] = data[index + 3] = 3
        data[index + 4] = data[index + 5] = data[index + 6] = data[index + 7] = 4
    if flag:
        data[index] = data[index + 1] = data[index + 2] = data[index + 3] = 5
        data[index + 4] = data[index + 5] = data[index + 6] = data[index + 7] = 6
    if flag:
        data[index] = data[index + 1] = data[index + 2] = data[index + 3] = 7
        data[index + 4] = data[index + 5] = data[index + 6] = data[index + 7] = 8
    if flag:
        data[index] = data[index + 1] = data[index + 2] = data[index + 3] = 9
        data[index + 4] = data[index + 5] = data[index + 6] = data[index + 7] = 10
    if flag:
        data[index] = data[index + 1] = data[index + 2] = data[index + 3] = 11
        data[index + 4] = data[index + 5] = data[index + 6] = data[index + 7] = 12
    return value


result = preserve(1, True, {}, 0)
assert_type(result, Literal[1])
# This should generate an error.
text: str = result


T = TypeVar("T", int, str)


def constrained(value: T, data: dict[int, int], index: int) -> T:
    if isinstance(value, str):
        data[index] = 1
        return value + ""
    data[index] = 2
    return value + 0
