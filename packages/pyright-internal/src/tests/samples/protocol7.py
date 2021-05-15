# This sample verifies that the type checker properly
# flags the use of a protocol class when it's used
# in the second parameter of isinstance.

from typing import Protocol, runtime_checkable


class P1(Protocol):
    name: str


@runtime_checkable
class P2(Protocol):
    name: str


def foo(a: int):
    # This should generate an error because P1 is not
    # runtime_checkable.
    if isinstance(a, P1):
        return

    if isinstance(a, P2):
        return
