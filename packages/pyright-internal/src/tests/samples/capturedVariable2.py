# This sample tests the case where a potentially-unbound variable
# in an outer scope is captured in an inner scope.

from typing import Literal


def func1(subj: Literal[0, 1]) -> None:
    v: int | None

    match subj:
        case 0:
            v = 1

    def inner1() -> int:
        # This should generate an error
        return v

    def inner2() -> bool:
        # This should generate an error
        return v is None
