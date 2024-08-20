# This sample tests basic handling of refinement types.

# pyright: reportMissingModuleSource=false

from typing import Annotated, Any, Iterable, TypedDict
from typing_extensions import IntValue


class TD1(TypedDict):
    x: int


def v_ok1(v: Annotated[int, IntValue("x")]):
    reveal_type(v, expected_text='int @ "x"')

def v_ok2(v: Annotated[int, IntValue(value=1)]):
    reveal_type(v, expected_text='int @ 1')

# This should generate an error because refinement types
# apply only to nominal class types.
v_bad1: Annotated[int | str, IntValue("x")]

# This should generate an error because refinement types
# apply only to nominal class types.
v_bad2: Annotated[Iterable, IntValue("x")]

# This should generate an error because refinement types
# apply only to nominal class types.
v_bad3: Annotated[TD1, IntValue("x")]

# This should generate an error because refinement types
# apply only to nominal class types.
v_bad4: Annotated[Any, IntValue("x")]


def x_ok1(v: int @ IntValue("x")):
    reveal_type(v, expected_text='int @ "x"')

def x_ok2(v: int @ IntValue(value=1)):
    reveal_type(v, expected_text='int @ 1')

# This should generate an error because refinement types
# apply only to nominal class types.
x_bad1: (int | str) @ IntValue("x")

# This should generate an error because refinement types
# apply only to nominal class types.
x_bad2: Iterable @ IntValue("x")

# This should generate an error because refinement types
# apply only to nominal class types.
x_bad3: TD1 @ IntValue("x")

# This should generate an error because refinement types
# apply only to nominal class types.
x_bad4: Any @ IntValue("x")
