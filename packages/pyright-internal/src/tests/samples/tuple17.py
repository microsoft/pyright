# This sample tests a limiter that prevents infinite recursion
# in the tuple inference logic.


def func1(val: int):
    t = None
    while True:
        t = (val or t, val)
        val += 1
        if val > 1000:
            break
    return t
