# This sample tests functools.partial with an unpacked TypedDict in the
# **kwargs annotation.

from functools import partial
from typing import TypedDict, Unpack


class DC1(TypedDict, total=False):
    x: str
    y: int


def test1(**kwargs: Unpack[DC1]) -> None: ...


test1_partial = partial(test1, x="")

# This should generate an error.
test1_partial(x=1)

# This should generate an error.
test1_partial(y="")

test1_partial(x="")
test1_partial(y=1)
