# This sample tests the handling of the "yield from" statement
# and inferred return types from generators that use this
# statement.


def f():
    yield from [1, 2, 3]


def g():
    yield from f()


a: dict[int, int] = {}
for i in g():
    a[i] = i
