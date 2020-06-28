# This sample validates that an unbound variable error is reported
# even if that variable has a type declaration.

def fn1():
    aaa: int

    # This should generate an error because aaa is unbound.
    return aaa


fn1()

