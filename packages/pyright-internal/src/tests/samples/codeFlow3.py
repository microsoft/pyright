# This sample tests the handling of a compound conditional statement
# where the first portion is statically determined to be false.


def func1():
    val = ""
    if False and val:
        pass
