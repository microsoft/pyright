# This sample tests issubclass calls that always evaluate to true.


def func1(p1: type[int], p2: type[int] | type[str]):
    a = issubclass(p2, str)

    b = issubclass(p2, (int, float))

    # This should generate an error because this is always true.
    c = issubclass(p2, (float, dict, int, str))

    d = issubclass(p1, float)

    e = issubclass(p2, (float, dict, int))

    # This should generate an error because this is always true.
    f = issubclass(p1, int)

    # This should not generate an error because it's within an assert.
    assert issubclass(p1, int)
