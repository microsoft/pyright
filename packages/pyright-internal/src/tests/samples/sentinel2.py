# This sample tests the handling of the sentinel builtin added in Python 3.15.

from dataclasses import dataclass
from typing import Literal, TypeAlias

# This should generate an error because the names don't match.
BAD_NAME1 = sentinel("OTHER")

# This should generate an error because the arg count is wrong.
BAD_CALL1 = sentinel()

# This should generate an error because the arg count is wrong.
BAD_CALL2 = sentinel("BAD_CALL2", 1)

# This should generate an error because the arg type is wrong.
BAD_CALL3 = sentinel(1)


MISSING = sentinel("MISSING")


def accept_sentinel(value: sentinel) -> None:
    pass


accept_sentinel(MISSING)

type TA1 = int | MISSING

TA2: TypeAlias = int | MISSING

# This should generate an error because Literal isn't appropriate here.
x: Literal[MISSING]


def func1(value: int | MISSING) -> None:
    if value is MISSING:
        reveal_type(value, expected_text="MISSING")
    else:
        reveal_type(value, expected_text="int")


# Attribute access on a sentinel instance should resolve through the
# regular MRO rather than being treated as an unknown descriptor.
reveal_type(MISSING.__eq__, expected_text="(value: object, /) -> bool")


@dataclass
class DC1:
    name: str | MISSING = MISSING


class ClassA:
    value: int | MISSING


def func4(dc: DC1, a: ClassA) -> None:
    reveal_type(dc.name, expected_text="str | MISSING")
    reveal_type(a.value, expected_text="int | MISSING")

    if dc.name is MISSING:
        reveal_type(dc.name, expected_text="MISSING")
    else:
        reveal_type(dc.name, expected_text="str")

    if dc.name is not MISSING:
        reveal_type(dc.name, expected_text="str")

    if a.value is not MISSING:
        reveal_type(a.value, expected_text="int")
