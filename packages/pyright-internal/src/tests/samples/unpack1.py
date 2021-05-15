# This sample tests the type checker's handling of the unpack operator.

# pyright: strict


class Foo:
    ...


class Bar:
    ...


a = [1, "hello", 3.4, Foo()]

b = [*a]


def int_only(a: int):
    ...


for c in b:
    if not isinstance(c, (float, str)):
        # This should generate an error because c can
        # be an int or foo.
        int_only(c)

        if not isinstance(c, Foo):
            # This should not generate an error.
            int_only(c)

# This should generate an error
x1 = *(1, 2, 3)

x2 = 2, *(1, 2, 3)

x3 = *(1, 2, 3), 2
