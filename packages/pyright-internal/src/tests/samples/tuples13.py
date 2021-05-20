# This sample tests indexing of tuples with slice expressions.

from typing import Literal, Tuple


def func1(val1: Tuple[int, str, None], val2: Tuple[int, ...]):
    x1 = val1[:2]
    t1: Literal["tuple[int, str]"] = reveal_type(x1)

    x2 = val1[-3:2]
    t2: Literal["tuple[int, str]"] = reveal_type(x2)

    x3 = val1[1:]
    t3: Literal["tuple[str, None]"] = reveal_type(x3)

    x4 = val1[1:-1]
    t4: Literal["tuple[str]"] = reveal_type(x4)

    x5 = val1[:-2]
    t5: Literal["tuple[int]"] = reveal_type(x5)

    x6 = val1[0:100]
    t6: Literal["Tuple[int | str | None, ...]"] = reveal_type(x6)

    x7 = val2[:2]
    t7: Literal["Tuple[int, ...]"] = reveal_type(x7)
