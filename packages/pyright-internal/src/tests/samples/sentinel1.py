# This sample tests the handling of Sentinel as described in PEP 661.

from typing import Literal, TypeAlias
from typing_extensions import Sentinel, TypeForm  # pyright: ignore[reportMissingModuleSource]

# This should generate an error because the names don't match.
BAD_NAME1 = Sentinel("OTHER")

# This should generate an error because the arg count is wrong.
BAD_CALL1 = Sentinel()

# This should generate an error because the arg count is wrong.
BAD_CALL2 = Sentinel("BAD_CALL2", 1)

# This should generate an error because the arg type is wrong.
BAD_CALL3 = Sentinel(1)


MISSING = Sentinel("MISSING")

type TA1 = int | MISSING

TA2: TypeAlias = int | MISSING

TA3 = int | MISSING

# This should generate an error because Literal isn't appropriate here.
x: Literal[MISSING]


def func1(value: int | MISSING) -> None:
    if value is MISSING:
        reveal_type(value, expected_text="MISSING")
    else:
        reveal_type(value, expected_text="int")


def func2(value=MISSING) -> None:
    pass


reveal_type(func2, expected_text="(value: Unknown | MISSING = MISSING) -> None")


def test_typeform[T](v: TypeForm[T]) -> TypeForm[T]: ...


reveal_type(test_typeform(MISSING), expected_text="TypeForm[MISSING]")


def func3(x: Literal[0, 3, "hi"] | MISSING) -> None:
    if x:
        reveal_type(x, expected_text="MISSING | Literal[3, 'hi']")
    else:
        reveal_type(x, expected_text="Literal[0]")


t1 = type(MISSING)
reveal_type(t1, expected_text="type[MISSING]")
