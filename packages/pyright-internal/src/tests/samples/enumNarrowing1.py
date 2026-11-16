# This sample tests type narrowing for equality (== and !=) comparisons
# between IntEnum/StrEnum members and primitive literals or literal unions.

from enum import IntEnum, IntFlag, StrEnum
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
