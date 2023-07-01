# This sample tests a difficult set of circular dependencies
# between untyped variables.

# pyright: strict

from typing import Dict


class A:
    pass


class B(A):
    pass


def func1(v: A, s: Dict[B, A]) -> object:
    if not isinstance(v, B):
        return v
    u = s.get(v)
    while isinstance(u, B):
        v = u
        u = s.get(v)
    x = v if u is None else u
    return x
