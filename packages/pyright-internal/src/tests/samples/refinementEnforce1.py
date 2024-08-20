# This sample tests enforced and unenforced refinement types.

# pyright: reportMissingModuleSource=false

from typing_extensions import IntValue, Shape


def get_int() -> int: ...


# This should generate an error.
i1: int @ 1 = get_int()

# This should generate an error.
i2: int @ IntValue(value=1) = get_int()

i3: int @ IntValue(value=1, enforce=False) = get_int()

i4: int @ "x" = get_int()

i5: int @ IntValue("x", enforce=False) = get_int()

# This should generate an error.
i6: int @ IntValue("x", enforce=True) = get_int()


class Tensor: ...


t1: Tensor @ Shape("x") = Tensor()

# This should generate an error.
t2: Tensor @ Shape("x", enforce=True) = Tensor()
