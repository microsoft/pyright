# This sample tests the handling of a compound conditional statement
# where the first portion is statically determined to be false.


def foo():
    message = ""
    if False and message:
        pass
