# This sample tests a difficult set of circular dependencies
# between untyped variables.

# pyright: strict

from typing import Iterable


def test(parts: Iterable[str]):
    ns = ""
    for part in parts:
        if ns:
            ns += "a"
        else:
            ns += part
