# This sample tests basic parsing of refinement predicates and
# refinement variable consistency.

# pyright: reportMissingModuleSource=false

from typing import Annotated
from typing_extensions import IntValue, Refinement, Shape, StrValue


class Tensor: ...


v_ok1: Annotated[int, IntValue("x if x > 1 and (x < 10 or x % 2 == 0)")]
v_ok2: Annotated[int, Shape("x, y if x > 1 and (x < 10 or x % 2 == 0)")]
v_ok3: Annotated[int, Shape("x, *y if x > 1 and (x < 10 or x % 2 == 0)")]


# This should generate a syntax error because ":" should be "if".
v_bad1: Annotated[int, IntValue("x: x > 1")]

# This should generate a syntax error because "x" isn't a bool value.
v_bad2: Annotated[int, IntValue("x if x")]

# This should generate a syntax error because "y" isn't an int value.
v_bad3: Annotated[int, Shape("x, *y if y < 1")]

# This should generate a syntax error because "x, y" isn't an int value.
v_bad4: Annotated[int, IntValue("x, y")]

# This should generate a syntax error because "x" isn't an int value.
v_bad5: Annotated[int, Shape("x if x < 1")]

# This should generate a syntax error because it's an invalid expression.
v_bad6: Annotated[int, IntValue("x if x < 1 x")]

# This should generate a syntax error because it's an invalid expression.
v_bad7: Annotated[int, IntValue("x if x.foo > 1")]

# This should generate a syntax error because it's an invalid expression.
v_bad8: Annotated[int, IntValue("x if x[1] > 1")]

# This should generate a syntax error because it's an unsupported call.
v_bad9: Annotated[int, IntValue("x if call(x)")]


class CustomRefinementDomain(Refinement):
    def __str__(self) -> str:
        return ""


# This should generate a syntax error because it's an unknown refinement domain.
v_bad10: Annotated[int, CustomRefinementDomain("x")]

# This should generate two errors because "x" is inconsistent.
v_bad11: int @ IntValue("x") | str @ StrValue("x") | Tensor @ Shape("x")


# This should generate two errors because "x" is inconsistent.
type TA_Bad1 = int @ IntValue("x") | str @ StrValue("x") | Tensor @ Shape("x")
