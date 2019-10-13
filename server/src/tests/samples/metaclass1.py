# This sample tests pyright's ability to use metaclasses.

from ctypes import Array, c_uint64
myArray = (c_uint64 * 5)()


