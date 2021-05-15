# This sample tests the case where a symbol is imported within an
# inner scope but the target symbol has global binding.


from typing import Literal


def func1():
    global Enum
    from enum import Enum


t_enum: Literal["Type[Enum]"] = reveal_type(Enum)
