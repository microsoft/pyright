# This sample tests the case where a symbol is imported within an
# inner scope but the target symbol has global binding.


def func1():
    global Enum
    from enum import Enum


reveal_type(Enum, expected_text="type[Enum]")
