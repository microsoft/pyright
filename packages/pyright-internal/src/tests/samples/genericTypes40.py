# This sample tests the type variable solving process when a
# callable type is involved.

from typing import Literal


def filter_fn(value: object):
    ...


v1 = filter(filter_fn, [1, 2, 3])
t1: Literal["Iterator[int]"] = reveal_type(v1)

v2 = filter(filter_fn, {1, 2})
t2: Literal["Iterator[int]"] = reveal_type(v2)

v3 = filter(filter_fn, {1: 2})
t3: Literal["Iterator[int]"] = reveal_type(v3)
