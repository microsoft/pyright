# This sample tests the case where dependent types within
# a loop are assigned using tuples.


def fibonacci():
    a, b = 1, 1
    while True:
        yield a
        a, b = b, a + b
        reveal_type(a, expected_text="int")
        reveal_type(b, expected_text="int")
