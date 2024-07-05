# This sample tests the handling of protocol classes that define properties
# to indicate a read-only attribute. It also tests that a member access through
# a protocol class (not an instance) is flagged as an error.

from typing import Protocol


class A(Protocol):
    @property
    def name(self) -> str: ...


class B:
    name: str


def do_something(a: A, class_a: type[A]) -> None:
    val1 = a.name
    reveal_type(val1, expected_text="str")

    # This should generate an error because accesses to
    # properties from a protocol class are not allowed.
    val2 = class_a.name

    val3: A = B()
