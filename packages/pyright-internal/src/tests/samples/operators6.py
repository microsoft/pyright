# This sample tests whether metaclasses that support operator
# magic methods work correctly.

import ctypes
from typing import Literal

v1 = ctypes.POINTER(ctypes.c_bool) * 3
t_v1: Literal["Type[Array[pointer[c_bool]]]"] = reveal_type(v1)

v2 = 3 * ctypes.POINTER(ctypes.c_bool)
t_v2: Literal["Type[Array[pointer[c_bool]]]"] = reveal_type(v2)
