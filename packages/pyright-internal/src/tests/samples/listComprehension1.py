# This sample tests type checking for list comprehensions.

from typing import Any, Generator, List

a = [1, 2, 3, 4]


def func1() -> Generator[int, None, None]:
    b = (elem for elem in a)
    return b


def func2() -> List[int]:
    c = [elem for elem in a]
    return c


def func3() -> List[str]:
    c = [elem for elem in a]

    # This should generate an error because
    # c is a List[int], which doesn't match
    # the declared return type.
    return c


def generate():
    for i in range(2):
        yield i


# Verify that generate returns a Generator.
s = generate()
s.close()
