# This sample tests the type variable solving process when a
# callable type is involved.

from typing import Literal


def filter_fn(value: object):
    ...


foo = filter(filter_fn, {1: ...})
t1: Literal["Iterator[int]"] = reveal_type(foo)
