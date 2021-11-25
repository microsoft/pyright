# This sample tests the reportUnusedVariable diagnostic check.


def func1(a: int):
    x = 4

    # This should generate an error if reportUnusedVariable is enabled.
    y = x

    _z = 4

    _ = 2

    __z__ = 5

    if x + 1:
        # This should generate an error if reportUnusedVariable is enabled.
        z = 3
    else:
        # This should generate an error if reportUnusedVariable is enabled.
        z = 5
