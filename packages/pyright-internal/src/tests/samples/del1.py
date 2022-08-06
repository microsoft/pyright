# This sample tests del statements.

# This should generate two errors because x1 and x2 are not defined.
del x1, x2

x1 = 1
del x1

# This should generate an error because x1 isn't defined.
del x1


def func1(y1: int):
    # This should generate an error because y2 is unbound.
    del y1, y2

    # This should generate an error because y1 is unbound.
    del y1

    y2 = 1
    del y2


class ClassA:
    # This should generate an error because z1 is unbound.
    del z1

    z1 = 1
    del z1
