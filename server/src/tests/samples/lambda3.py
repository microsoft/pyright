# This sample tests the handling of default parameter value
# expressions in a lambda.


def test1():
    var = 1

    lambda _=var: ...


def test2():
    # This should generate an error because var2 isn't defined.
    lambda _=var2: ...


def test3():
    var = 0
    lambda var=var: ...
