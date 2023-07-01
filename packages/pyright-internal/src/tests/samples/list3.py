# This sample tests list inference in a loop where the type of
# the inferred list changes each time through the loop.


def func1(k: str):
    keys = ["a", "b", "c"]
    value = []

    while keys:
        if not k:
            continue

        if not k:
            value = {k: value}
        else:
            value = [None] * int(k) + [value]

    return value
