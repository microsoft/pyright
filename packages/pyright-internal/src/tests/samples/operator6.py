# This sample tests whether metaclasses that support operator
# magic methods work correctly.

import ctypes

v1 = ctypes.POINTER(ctypes.c_bool) * 3
reveal_type(v1, expected_text="type[Array[_Pointer[c_bool]]]")

v2 = 3 * ctypes.POINTER(ctypes.c_bool)
reveal_type(v2, expected_text="type[Array[_Pointer[c_bool]]]")
