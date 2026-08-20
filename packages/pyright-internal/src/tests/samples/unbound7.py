# This sample tests that assignments in unreachable code still make
# a name local, matching CPython.

variable = "global"


def example_with_local():
    # This should generate an error because the later assignment makes
    # "variable" a local, so this read is unbound.
    return variable
    variable = "local"


def example_without_local():
    return variable


def outer():
    def inner():
        # This should not generate an error; the assignment below binds
        # "variable" in outer even though it is unreachable.
        nonlocal variable

    return
    variable = "local"
