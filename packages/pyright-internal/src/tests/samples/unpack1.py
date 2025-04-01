# This sample tests the type checker's handling of the unpack operator.

# pyright: strictListInference=true


class Class1: ...


class Class2: ...


a = [1, "hello", 3.4, Class1()]

b = [*a]


def int_only(a: int): ...


for c in b:
    if not isinstance(c, (float, str)):
        # This should generate an error because c can
        # be an int or foo.
        int_only(c)

        if not isinstance(c, Class1):
            # This should not generate an error.
            int_only(c)

# This should generate an error
x1 = *(1, 2, 3)

x2 = 2, *(1, 2, 3)

x3 = *(1, 2, 3), 2


[d1, *e1, f1] = [1, 2, 3, 4]
reveal_type(e1, expected_text="list[int]")

[*d2, e2, f2] = [1, 2, 3, 4]
reveal_type(d2, expected_text="list[int]")

[d3, e3, *f3] = (1, 2, 3, 4)
reveal_type(f3, expected_text="list[int]")

[g1, g2, g3] = (1, 2, 3)

# This should generate an error.
[g1, g2, g3, g4] = (1, 2, 3)

# This should generate an error.
[g1, g2] = (1, 2, 3)
