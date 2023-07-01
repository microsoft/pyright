# This sample tests a difficult set of circular dependencies
# between untyped variables.

# pyright: strict

from typing import Iterable


def func1(parts: Iterable[str]):
    x: list[str] = []
    ns = ""
    for part in parts:
        if ns:
            ns += "a"
        else:
            ns += part
        x.append(ns)
