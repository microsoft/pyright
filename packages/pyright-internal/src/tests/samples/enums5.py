# This sample tests logical operators on enums.

import enum
from typing import Literal


class CustomFlags(enum.Flag):
    A = enum.auto()
    B = enum.auto()
    C = A | B


flags1 = CustomFlags.A | CustomFlags.B
t1: Literal["CustomFlags"] = reveal_type(flags1)

flags2 = CustomFlags.A & CustomFlags.B
t2: Literal["CustomFlags"] = reveal_type(flags2)
