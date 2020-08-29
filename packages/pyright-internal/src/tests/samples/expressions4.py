# This sample tests the handling of "in" and "not in" operators.

from typing import List, Set, Union


def func1(a: Union[int, str]):
    # This should generate an error because a's type doesn't
    # support a __contains__ method.
    if 3 in a:
        pass

    # This should generate an error because a's type doesn't
    # support a __contains__ method.
    if 3 not in a:
        pass


def func(a: Union[List[int], Set[float]]):
    if 3 in a:
        pass

    if 3 not in a:
        pass
