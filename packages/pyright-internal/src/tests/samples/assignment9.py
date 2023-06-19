# This sample tests assignment when the types are invariant and the
# source or destination are unions that contains subtypes which are
# subclasses of each other.

from datetime import datetime


class FloatSubclass(float):
    pass


float_list: list[float] = [1.0, 2.0]

v1: list[float | FloatSubclass] = float_list

v2: list[int | float] = float_list

# This should generate an error.
v3: list[int | float | datetime] = float_list


v4: list[FloatSubclass | float] = []
v5: list[float] = v4
