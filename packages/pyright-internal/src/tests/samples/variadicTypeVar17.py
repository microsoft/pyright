# This sample tests the case where an unpacked tuple argument in a call
# expression is matched to an `*args` parameter that has a declared type
# that includes an unpacked TypeVarTuple.

from typing_extensions import TypeVarTuple

Ts = TypeVarTuple("Ts")


def call0(*args: *Ts) -> tuple[*Ts]:
    ...

def func1(*args: *tuple[int, str]):
    reveal_type(call0(*args), expected_text="tuple[int, str]")

def func2(*args: *tuple[int, ...]):
    reveal_type(call0(*args), expected_text="tuple[int, ...]")

def func3(*args: *tuple[int, *tuple[str, ...], float]):
    reveal_type(call0(*args), expected_text="tuple[int, *tuple[str, ...], float]")

def func4(*args: *Ts) -> tuple[*Ts]:
    call0(*args)
    return args

