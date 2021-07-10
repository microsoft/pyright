# This sample tests the special-case handling of the __add__ operator
# when two tuples of known types are added together.

from typing import Literal, Tuple


v1 = () + ()
t1: Literal["tuple[()]"] = reveal_type(v1)


def func1(a: Tuple[int, int, int], b: Tuple[str, str]):
    t2: Literal["tuple[int, int, int, str, str]"] = reveal_type(a + b)


def func2(a: Tuple[int, int, int], b: Tuple[str, ...]):
    t2: Literal["Tuple[int | str, ...]"] = reveal_type(a + b)
