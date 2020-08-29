# This sample tests pyright's ability to use metaclasses.

from ctypes import Array, c_uint64
myArray1 = (c_uint64 * 5)()

myArray2: Array[c_uint64] = (c_uint64 * 5)()
