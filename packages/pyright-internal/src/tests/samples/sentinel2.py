# This sample tests the handling of the sentinel builtin added in Python 3.15.

from dataclasses import dataclass
from typing import Literal, TypeAlias, assert_type

DISPLAY_NAME = sentinel("OTHER")
EMPTY_NAME = sentinel("")
CUSTOM_REPR = sentinel("display", repr="<missing>")

assert_type(DISPLAY_NAME, DISPLAY_NAME)
assert_type(EMPTY_NAME, EMPTY_NAME)
assert_type(CUSTOM_REPR, CUSTOM_REPR)

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

common_class: type[MISSING] = type(MISSING)
reveal_type(common_class, expected_text="type[sentinel]")
assert_type(type(MISSING), type[MISSING])
assert_type(MISSING.__class__, type[MISSING])
assert_type(common_class("MISSING", repr=None), sentinel)
assert_type(MISSING, MISSING)

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


def identity[T](value: T) -> T:
    return value


assert_type(identity(MISSING), MISSING)


def round_trip(value: int | MISSING) -> None:
    result = identity(value)
    assert_type(result, int | MISSING)
    if result is not MISSING:
        assert_type(result, int)
    else:
        assert_type(result, MISSING)
