# This sample exercises the type analyzer's assert type constraint logic.

from typing import Union

def foo(a: Union[str, int]) -> int:

    if True:
        # This should generate an error because
        # a could be a str.
        return a

    assert isinstance(a, int)

    return a
