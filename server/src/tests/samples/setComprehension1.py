# This sample tests type checking for set comprehensions.

from typing import Generator, Set

a = [1, 2, 3, 4]

def func1() -> Generator[int]:
    b = (elem for elem in a)
    return b


def func2() -> Set[int]:
    c = {elem for elem in a}
    return c

def func3() -> Set[str]:
    c = {elem for elem in a}

    # This should generate an error because
    # c is a Set[int], which doesn't match
    # the declared return type.
    return c

def generate():
    for i in range(2):
        yield i

# Verify that generate returns a Generator.
s = generate()
s.close()

