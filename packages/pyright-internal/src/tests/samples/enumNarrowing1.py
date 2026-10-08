# This sample tests type narrowing for equality (== and !=) comparisons
# between IntEnum/StrEnum members and primitive literals or literal unions.

from enum import IntEnum, IntFlag, StrEnum, auto
from typing import Literal, Union, assert_type

class Priority(IntEnum):
    LOW = 10
    HIGH = 20

class Status(StrEnum):
    PENDING = "pending"
    DONE = "done"

def test_enum_var_equals_int_literal(p: Priority):
    if p == 20:
        assert_type(p, Literal[Priority.HIGH])
    else:
        assert_type(p, Literal[Priority.LOW])

def test_int_var_equals_enum_literal(x: Union[Literal[10], Literal[20], Literal[30]]):
    if x == Priority.HIGH:
        assert_type(x, Literal[20])
    else:
        assert_type(x, Union[Literal[10], Literal[30]])

def test_str_var_equals_strenum_literal(s: Union[Literal["pending"], Literal["done"], Literal["failed"]]):
    if s == Status.DONE:
        assert_type(s, Literal["done"])
    else:
        assert_type(s, Union[Literal["pending"], Literal["failed"]])

def test_strenum_var_equals_str_literal(st: Status):
    if st == "done":
        assert_type(st, Literal[Status.DONE])
    else:
        assert_type(st, Literal[Status.PENDING])


class Flags(IntFlag):
    READ = 1
    WRITE = 2


class CustomInt(int): ...


def test_int_flag(f: Flags):
    if f == 3:
        assert_type(f, Flags)
    else:
        assert_type(f, Flags)


def test_bool_vs_int(x: int, b: bool):
    # bool is derived from int, but its literal values are distinct from
    # int literal values, so no narrowing should occur here.
    if x == True:
        assert_type(x, int)

    if b == 1:
        assert_type(b, bool)


def test_custom_int_subclass(c: CustomInt):
    # A custom int subclass is not an enum, so it should not be narrowed
    # to a primitive literal type.
    if c == 20:
        assert_type(c, CustomInt)

    if c == Priority.HIGH:
        assert_type(c, CustomInt)


def test_plain_enum(e: Priority, y: int):
    # An int variable compared against an enum member should retain its
    # declared type rather than narrowing to the enum literal.
    if y == Priority.HIGH:
        assert_type(y, int)


def get_int() -> int:
    return 30


class AutoValue(IntEnum):
    # The underlying primitive values of these members are not known
    # statically, so equality comparisons with int literals cannot be
    # used for narrowing in either direction.
    RED = auto()
    GREEN = auto()


class ComputedValue(IntEnum):
    FIRST = get_int()
    SECOND = 40


def test_auto_member_equals_int_literal():
    v = AutoValue.RED
    if v == 1:
        # At runtime AutoValue.RED == 1 is True, so this branch is reachable.
        assert_type(v, Literal[AutoValue.RED])
    else:
        assert_type(v, Literal[AutoValue.RED])


def test_int_var_equals_auto_member(x: Literal[1, 3]):
    if x == AutoValue.RED:
        # At runtime x == AutoValue.RED is True when x is 1, so this branch
        # is reachable and x cannot be narrowed.
        assert_type(x, Literal[1, 3])
    else:
        assert_type(x, Literal[1, 3])


def test_auto_enum_var_equals_int_literal(v: AutoValue):
    if v == 1:
        assert_type(v, AutoValue)
    else:
        assert_type(v, Literal[AutoValue.RED, AutoValue.GREEN])


def test_computed_member_equals_int_literal():
    v = ComputedValue.FIRST
    if v == 30:
        # At runtime this branch is reachable when get_int() returns 30.
        assert_type(v, Literal[ComputedValue.FIRST])
    else:
        assert_type(v, Literal[ComputedValue.FIRST])


def test_computed_enum_var_equals_int_literal(v: ComputedValue):
    if v == 40:
        # SECOND has a known value that matches, but FIRST's value is
        # unknown and could also be 40, so no narrowing can occur.
        assert_type(v, ComputedValue)
    else:
        assert_type(v, Literal[ComputedValue.FIRST])


def test_match_int_literal_pattern(v: ComputedValue):
    # A literal pattern goes through the same comparison. SECOND has a known
    # value that matches, but FIRST's value is unknown and could be 40 too,
    # so FIRST must survive into the matching case and the fallback.
    match v:
        case 40:
            assert_type(v, ComputedValue)
        case _:
            assert_type(v, ComputedValue)


def test_match_auto_int_literal_pattern(v: AutoValue):
    # Neither member's value is known, so a literal pattern narrows nothing.
    match v:
        case 1:
            assert_type(v, AutoValue)
        case _:
            assert_type(v, AutoValue)
