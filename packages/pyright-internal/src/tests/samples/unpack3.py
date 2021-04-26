# This sample tests the reporting of errors related to
# unpack operators within tuple expressions not enclosed
# in parentheses when used with return statements. Support
# for this was added in Python 3.8.


def test1():
    a = [1, 2, 3]
    b = (4, *a, 5)
    return (4, *b, 5)


def test2():
    a = [1, 2, 3]
    # This should generate an error for versions of Python <3.8
    return 4, *a, 5
