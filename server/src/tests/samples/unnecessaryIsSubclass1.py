# This sample tests unnecessary issubclass error reporting.

from typing import Union, Type

def foo(p1: Type[int], p2: Union[Type[int], Type[str]]):
    a = issubclass(p2, str)

    b = issubclass(p2, (int, float))

    # This should generate an error because this is always true.
    c = issubclass(p2, (float, dict, int, str))

    # This should generate an error because this is always false.
    d = issubclass(p1, float)

    e = issubclass(p2, (float, dict, int))

    # This should generate an error because this is always true.
    f = issubclass(p1, int)

    # This should not generate an error because it's within an assert.
    assert issubclass(p1, int)

    