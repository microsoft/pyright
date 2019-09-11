# This sample tests unnecessary isinstance error reporting.

from typing import Union

def foo(p1: int, p2: Union[int, str]):
    a = isinstance(p2, str)

    b = isinstance(p2, (int, float))

    # This should generate an error because this is always true.
    c = isinstance(p2, (float, dict, int, str))

    # This should generate an error because this is always false.
    d = isinstance(p1, float)

    e = isinstance(p2, (float, dict, int))

    # This should generate an error because this is always true.
    f = isinstance(p1, int)

    # This should not generate an error because it's within an assert.
    assert isinstance(p1, int)

    