# This sample tests the Python 3.8 assignment expressions.

def func1():
    b = 'a'
    d = 'b'

    a = (b := 3)

    # This should generate an error because the
    # item to the left of an assignment expression
    # must be a name.
    a + 3 := 3

    # This should generate an error because parens
    # are required in this case.
    c = d := 3
