# This sample tests the case where a lambda includes one or more parameters
# that accept a default value and the the expected type does not include
# these parameters. In this case, the types of the extra parameters should
# be inferred based on the default value type.

# pyright: strict

from typing import Callable


def func1() -> list[Callable[[int], int]]:
    return [lambda x, i=i: i * x for i in range(5)]
