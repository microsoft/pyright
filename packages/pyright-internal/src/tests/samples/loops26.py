# This sample tests proper type narrowing within a double loop.

# pyright: strict

from typing import Callable


def func(call: Callable[[], None] | None):
    while True:
        while True:
            if call is None or call():
                break
