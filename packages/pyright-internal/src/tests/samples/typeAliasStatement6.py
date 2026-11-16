# This sample tests that a PEP 695 "type" statement declared within a
# class body is visible to an annotation within that same class body
# under PEP 649 postponed annotation evaluation (the default as of
# Python 3.14), rather than being skipped in favor of a same-named
# alias in an outer scope.

from typing import reveal_type

type TA1 = str


class ClassA:
    type TA1 = int
    a: TA1


reveal_type(ClassA.a, expected_text="int")
