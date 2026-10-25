# This sample tests the inferred return type of a function that
# returns a module attribute whose value depends on a call to
# that function.

from . import circular3


def func1(flag: bool):
    if flag:
        return circular3.v1
    return None


reveal_type(func1, expected_text="(flag: bool) -> (Unknown | int | None)")

v1 = func1(False) or 1
