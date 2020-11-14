# This sample tests the handling of magic methods on
# the tuple class.

from typing import Tuple


def func1(t1: Tuple[int, ...], t2: Tuple[int, ...]):
    t1 >= t2


def func2(t1: Tuple[int, ...], t2: Tuple[str, int]):
    t1 < t2


def func3(t1: Tuple[int, int], t2: Tuple[int, ...]):
    t1 > t2


def func4(t1: Tuple[int, ...], t2: Tuple[str, ...]):
    # This should generate an error
    t1 <= t2
