# This sample tests the inferred type of a variable assigned through
# a nonlocal or global binding when the assigned value reads the
# variable's previous value.

v2 = 1
v4 = 1


def func1():
    v1 = 1

    def inner():
        nonlocal v1
        v1 = [v1]
        return v1

    reveal_type(inner(), expected_text="list[int | list[int]]")


def func2():
    global v2
    v2 = [v2]
    return v2


reveal_type(func2(), expected_text="list[int | list[int]]")


def func3():
    v3 = 1

    def inner():
        nonlocal v3
        r = [v3]
        v3 = r
        return r

    reveal_type(inner(), expected_text="list[int | list[int]]")


def func4():
    global v4
    r = [v4]
    v4 = r
    return r


reveal_type(func4(), expected_text="list[int | list[int]]")


def func5():
    v5 = 1

    def inner():
        nonlocal v5
        v5 = [v5]
        return v5

    # This should generate an error.
    inner()[0].bit_length()
