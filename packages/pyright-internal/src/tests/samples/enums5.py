# This sample tests logical operators on enums.

import enum


class CustomFlags(enum.Flag):
    A = enum.auto()
    B = enum.auto()
    C = A | B


flags1 = CustomFlags.A | CustomFlags.B
reveal_type(flags1, expected_text="CustomFlags")

flags2 = CustomFlags.A & CustomFlags.B
reveal_type(flags2, expected_text="CustomFlags")
