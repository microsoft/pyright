# This sample tests that "possibly unbound" error messages don't propagate.


def foo(a: bool):
    if a:
        b = 3

    # This should generate an error.
    c = b

    # These should not.
    d = c
    e = d

