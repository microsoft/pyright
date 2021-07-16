# This sample tests expected diagnostics for augmented assignment
# expressions.

from typing import List, Optional


def add_values(
    values1: List[float] = [], values2: Optional[List[float]] = None
) -> None:
    values3 = None

    # This should generate an error
    values1 += values2

    if values2 is not None:
        values1 += values2

    # This should generate an error
    values1 -= values2

    # This should generate an error
    values1 += values3

