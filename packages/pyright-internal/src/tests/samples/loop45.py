# This sample tests the case where a match statement is used in a loop
# and the subject is potentially narrowed in the loop, therefore creating
# a circular dependency.

from typing import Literal


def func1(lit: Literal["a", "b"]) -> None:
    for _ in range(2):
        match lit:
            case "a":
                v = "123"

            case "b":
                v = "234"

        v.replace(",", ".")
