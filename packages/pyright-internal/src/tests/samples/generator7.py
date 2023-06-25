# This sample tests the handling of the "yield from" statement
# and inferred return types from generators that use this
# statement.


def func1():
    yield from [1, 2, 3]


def func2():
    yield from func1()


a: dict[int, int] = {}
for i in func2():
    a[i] = i
