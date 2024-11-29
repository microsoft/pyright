# This sample tests the case where a function accesses its own decorated
# form within a loop.

from contextlib import contextmanager


@contextmanager
def func1():
    yield

    for _ in ():
        with func1():
            return
