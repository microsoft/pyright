# This sample tests the check that "yield" is not used outside
# of a function or lambda.

a = lambda: (yield)


def func1(a: bool):
    if a:
        yield 3
    yield 5


# This should generate an error
yield 7


class Foo:
    # This should generate an error
    yield
