# This sample exercises the type analyzer's type narrowing
# logic for assert statements.

condition: bool = True


def func1(a: str | int) -> int:
    if condition:
        # This should generate an error because
        # a could be a str.
        return a

    assert isinstance(a, int)

    return a


def func2(a: str | int) -> int:
    # Test the form of "assert" that includes a message string.
    assert isinstance(a, int), "Message"
    return a
