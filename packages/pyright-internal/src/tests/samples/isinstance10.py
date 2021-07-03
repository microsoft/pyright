# This sample tests the case where isinstance type narrowing is used
# with a protocol class that supports runtime checking.

# pyright: reportUnnecessaryIsInstance=true

from typing import Any, Iterable, Literal, Sized


def f(v: Any) -> bool:
    if isinstance(v, Iterable):
        t_v1: Literal["Iterable[Unknown]"] = reveal_type(v)
        if isinstance(v, Sized):
            t_v2: Literal["<subclass of Iterable and Sized>"] = reveal_type(v)
            return True
    return False
