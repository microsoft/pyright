# This sample verifies that the reportOptionalOperand diagnostic
# isn't generated when the RHS operand accepts None.

# pyright: reportIncompatibleMethodOverride=false

from typing import Optional


class Cmp:
    def __eq__(self, other: "Optional[Cmp]") -> bool: ...

    def __lt__(self, other: "Optional[Cmp]") -> bool: ...

    def __gt__(self, other: "Cmp") -> bool: ...


def valid(value: Optional[Cmp], needed: Cmp):
    x = value > needed
    y = value == needed

    # This should generate an error if reportOptionalOperand is enabled.
    z = value < needed
