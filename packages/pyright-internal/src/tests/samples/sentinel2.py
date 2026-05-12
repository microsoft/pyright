# This sample tests the handling of the sentinel builtin added in Python 3.15.

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

type TA1 = int | MISSING

TA2: TypeAlias = int | MISSING

# This should generate an error because Literal isn't appropriate here.
x: Literal[MISSING]


def func1(value: int | MISSING) -> None:
    if value is MISSING:
        reveal_type(value, expected_text="MISSING")
    else:
        reveal_type(value, expected_text="int")
