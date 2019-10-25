# This sample exercises the type analyzer's assert type constraint logic.

from typing import Union

condition: bool = True

def foo(a: Union[str, int]) -> int:

    if condition:
        # This should generate an error because
        # a could be a str.
        return a

    assert isinstance(a, int)

    return a


def foo(a: Union[str, int]) -> int:
    # Test the form of "assert" that includes a message string.
    assert isinstance(a, int), "Message"
    return a
