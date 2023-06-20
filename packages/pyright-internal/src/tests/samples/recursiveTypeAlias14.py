# This sample tests the case where a recursive type alias contains
# a `Sequence` that potentially overlaps with str (which derives from
# Sequence[str]).

from typing import Sequence


NestedIntList = int | Sequence["NestedIntList"]


def func1() -> NestedIntList:
    result: NestedIntList = 1
    for _ in range(1):
        result = [result]
    return result


def func2() -> NestedIntList:
    # This should generate an error.
    result: NestedIntList = ""
    for _ in range(1):
        result = [result]
    return result
